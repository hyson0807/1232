const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const dotenv = require('dotenv');

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// Supabase 클라이언트
const supabase = createClient(process.env.KEY_1, process.env.KEY_2);

const { SolapiMessageService } = require('solapi');
const res = require("express/lib/response");
const messageService = new SolapiMessageService(process.env.SOLAPI_API_KEY, process.env.SOLAPI_API_SECRET);
const otpStore = new Map();
const jwt = require('jsonwebtoken');


const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

app.get('/', (req, res) => {
    res.json({ message: 'Server is running' });
});

const secret = process.env.JWT_SECRET;


function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

app.post('/send-otp', async (req, res) => {
    try {
        const { phone } = req.body;
        const otp = generateOTP();
        otpStore.set(phone, { otp, expires: Date.now() + 300000 });
        console.log('생성된 OTP:', otp);

        const result = await messageService.send({
            'to': phone,
            'from': process.env.SENDER_PHONE,
            'text': `verification: ${otp}`
        })
        console.log('SMS 발송 성공:', result);
        res.json({ success: true});

    }  catch (error) {
        console.error('OTP 발송 실패:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
})

app.post('/verify-otp', async (req, res) => {
    try {
        const { phone, otp, userType } = req.body;
        console.log('OTP 검증11111111:', phone, otp, userType);

        // 개발 모드 테스트 계정 (OTP: 123456)
        const isDevelopment = process.env.NODE_ENV !== 'production';
        const isTestOTP = otp === '123456';
        const testAccounts = {
            '+821011111111': { name: '테스트 구직자', type: 'user' },
            '+821022222222': { name: '테스트 회사', type: 'company' }
        };

        if (isDevelopment && isTestOTP && testAccounts[phone]) {
            // 테스트 계정 처리
            console.log('테스트 계정 로그인:', phone);

            // 기존 유저 확인
            const { data: existingUser, error: fetchError } = await supabase
                .from('profiles')
                .select('*')
                .eq('phone_number', phone)
                .single();

            if (fetchError && fetchError.code !== 'PGRST116') {
                throw fetchError;
            }

            let token;
            let userData;
            let onboardingStatus;

            if (existingUser) {
                // 기존 테스트 유저 로그인
                token = jwt.sign({
                    userId: existingUser.id,
                    phone: phone,
                    userType: existingUser.user_type
                }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '7d' });

                userData = {
                    userId: existingUser.id,
                    phone: phone,
                    userType: existingUser.user_type,
                    isNewUser: false
                };

                onboardingStatus = {
                    completed: existingUser.onboarding_completed || false
                };
            } else {
                // 신규 테스트 유저 생성
                const testInfo = testAccounts[phone];

                const { data: authData, error: authError } = await supabase.auth.admin.createUser({
                    phone: phone,
                    phone_confirm: true
                });

                if (authError) throw authError;

                const { error: profileError } = await supabase
                    .from('profiles')
                    .insert({
                        id: authData.user.id,
                        phone_number: phone,
                        user_type: testInfo.type,
                        name: testInfo.name,
                        onboarding_completed: false
                    });

                if (profileError) {
                    await supabase.auth.admin.deleteUser(authData.user.id);
                    throw profileError;
                }

                if (userType === 'user') {
                    // user_info 테이블에 기본 정보 생성
                    const { error: userInfoError } = await supabase
                        .from('user_info')
                        .insert({
                            user_id: authData.user.id,
                            // 기본값들은 DB 스키마에 정의되어 있음
                        });

                    if (userInfoError) {
                        console.error('user_info 생성 실패:', userInfoError);
                        // user_info 생성 실패해도 회원가입은 계속 진행
                        // 나중에 프로필 업데이트 시 생성될 수 있음
                    }
                } else if (userType === 'company') {
                    // company_info 테이블에 기본 정보 생성
                    const { error: companyInfoError } = await supabase
                        .from('company_info')
                        .insert({
                            company_id: authData.user.id,
                            // 기본값들은 DB 스키마에 정의되어 있음
                        });

                    if (companyInfoError) {
                        console.error('company_info 생성 실패:', companyInfoError);
                        // company_info 생성 실패해도 회원가입은 계속 진행
                        // 나중에 프로필 업데이트 시 생성될 수 있음
                    }
                }

                token = jwt.sign({
                    userId: authData.user.id,
                    phone: phone,
                    userType: testInfo.type
                }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '7d' });

                userData = {
                    userId: authData.user.id,
                    phone: phone,
                    userType: testInfo.type,
                    isNewUser: true
                };

                onboardingStatus = {
                    completed: false
                };
            }

            return res.json({
                success: true,
                token: token,
                user: userData,
                onboardingStatus: onboardingStatus,
                message: '테스트 계정으로 로그인되었습니다'
            });
        }

        // 일반 OTP 확인
        const stored = otpStore.get(phone);
        if (!stored) {
            return res.status(400).json({
                success: false,
                error: 'OTP를 찾을 수 없습니다'
            });
        }

        // 만료 시간 확인
        if (Date.now() > stored.expires) {
            otpStore.delete(phone);
            return res.status(400).json({
                success: false,
                error: 'OTP가 만료되었습니다'
            });
        }

        // OTP 일치 확인
        if (stored.otp !== otp) {
            return res.status(400).json({
                success: false,
                error: '잘못된 인증번호입니다'
            });
        }

        // OTP 삭제 (한 번만 사용 가능)
        otpStore.delete(phone);

        // 기존 유저 확인
        const { data: existingUser, error: fetchError } = await supabase
            .from('profiles')
            .select('*')
            .eq('phone_number', phone)
            .single();

        let token;
        let userData;
        let onboardingStatus;

        // 에러가 있지만 단순히 유저가 없는 경우가 아닌 경우 처리
        if (fetchError && fetchError.code !== 'PGRST116') {
            throw fetchError;
        }

        if (existingUser) {
            // 기존 유저 - 로그인 처리
            console.log('기존 유저 로그인:', existingUser.id);

            token = jwt.sign({
                userId: existingUser.id,
                phone: phone,
                userType: existingUser.user_type
            }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '7d' });

            userData = {
                userId: existingUser.id,
                phone: phone,
                userType: existingUser.user_type,
                isNewUser: false
            };

            // 온보딩 상태는 profiles 테이블에서 바로 확인
            onboardingStatus = {
                completed: existingUser.onboarding_completed || false
            };

        } else {
            // 신규 유저 - 회원가입 처리
            console.log('신규 유저 회원가입');

            // userType이 제공되지 않은 경우 체크
            if (!userType) {
                return res.status(400).json({
                    success: false,
                    error: '신규 가입 시 userType이 필요합니다'
                });
            }

            // Supabase Auth에 유저 생성
            const { data: authData, error: authError } = await supabase.auth.admin.createUser({
                phone: phone,
                phone_confirm: true
            });

            if (authError) {
                throw authError;
            }

            // profiles 테이블에 추가 정보 저장 (onboarding_completed는 기본값 false)
            const { error: profileError } = await supabase
                .from('profiles')
                .insert({
                    id: authData.user.id,
                    phone_number: phone,
                    user_type: userType,
                    onboarding_completed: false  // 명시적으로 false 설정
                });

            if (profileError) {
                // 프로필 생성 실패 시 auth 유저도 삭제 (롤백)
                await supabase.auth.admin.deleteUser(authData.user.id);
                throw profileError;
            }

            if (userType === 'user') {
                // user_info 테이블에 기본 정보 생성
                const { error: userInfoError } = await supabase
                    .from('user_info')
                    .insert({
                        user_id: authData.user.id,
                        // 기본값들은 DB 스키마에 정의되어 있음
                    });

                if (userInfoError) {
                    console.error('user_info 생성 실패:', userInfoError);
                    // user_info 생성 실패해도 회원가입은 계속 진행
                    // 나중에 프로필 업데이트 시 생성될 수 있음
                }
            } else if (userType === 'company') {
                // company_info 테이블에 기본 정보 생성
                const { error: companyInfoError } = await supabase
                    .from('company_info')
                    .insert({
                        company_id: authData.user.id,
                        // 기본값들은 DB 스키마에 정의되어 있음
                    });

                if (companyInfoError) {
                    console.error('company_info 생성 실패:', companyInfoError);
                    // company_info 생성 실패해도 회원가입은 계속 진행
                    // 나중에 프로필 업데이트 시 생성될 수 있음
                }
            }

            // JWT 토큰 생성
            token = jwt.sign({
                userId: authData.user.id,
                phone: phone,
                userType: userType
            }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '7d' });

            userData = {
                userId: authData.user.id,
                phone: phone,
                userType: userType,
                isNewUser: true
            };

            // 신규 유저는 무조건 온보딩 미완료
            onboardingStatus = {
                completed: false
            };
        }

        // 성공 응답
        console.log('인증 성공:', userData.userId);
        console.log('온보딩 완료 여부:', onboardingStatus.completed);

        res.json({
            success: true,
            token: token,
            user: userData,
            onboardingStatus: onboardingStatus,
            message: userData.isNewUser ? '회원가입이 완료되었습니다' : '로그인되었습니다'
        });

    } catch (error) {
        console.error('OTP 검증 실패:', error);

        // 에러 타입에 따른 응답
        if (error.message?.includes('duplicate key')) {
            res.status(400).json({
                success: false,
                error: '이미 등록된 전화번호입니다'
            });
        } else {
            res.status(500).json({
                success: false,
                error: '인증 처리 중 오류가 발생했습니다'
            });
        }
    }
});
























// 기존 이메일 회원가입 엔드포인트
app.post('/signup', async (req, res) => {
    try {
        const { email, password, user_type } = req.body;

        if(!email || !password || !user_type) {
            return res.status(400).json({
                error: '필수정보누락(email||password||user_type)'
            });
        }

        const {error: authError, data: authData} = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
        });

        if(authError) {
            return res.status(400).json({
                error: authError.message
            });
        } else console.log("Auth signup successful");

        const {error: profilesError} = await supabase.from("profiles").insert({
            id: authData.user.id,
            user_type: user_type,
            email: email,
        });

        if(profilesError) {
            await supabase.auth.admin.deleteUser(authData.user.id);
            return res.status(500).json({
                error: '프로필 생성 실패'
            });
        }

        return res.status(201).json({
            success: true,
            user: {
                auth_id: authData.user.id,
                user_type: user_type
            }
        });

    } catch (error) {
        console.error('Signup error:', error);
        return res.status(500).json({
            error: '서버오류(회원가입 실패)'
        });
    }
});

// 회사에 메시지 전송 엔드포인트
app.post('/send-message-to-company', async (req, res) => {
    try {
        const { user_id, company_number } = req.body;

        // 입력 검증
        if (!user_id || !company_number) {
            return res.status(400).json({
                success: false,
                error: '필수 정보가 누락되었습니다.'
            });
        }

        // 1. 유저 프로필 정보 가져오기
        const { data: userProfile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user_id)
            .single();

        if (profileError || !userProfile) {
            console.error('유저 정보 조회 오류:', profileError);
            return res.status(404).json({
                success: false,
                error: '유저 정보를 찾을 수 없습니다.'
            });
        }

        // 2. 유저가 선택한 키워드 가져오기
        const { data: userKeywords, error: keywordError } = await supabase
            .from('user_keyword')
            .select('keyword_id')
            .eq('user_id', user_id);

        if (keywordError) {
            console.error('키워드 조회 오류:', keywordError);
            return res.status(500).json({
                success: false,
                error: '키워드 정보를 가져오는데 실패했습니다.'
            });
        }

        // 3. 키워드 정보 가져오기 (keyword 테이블에서)
        let keywordList = '미등록';

        if (userKeywords && userKeywords.length > 0) {
            const keywordIds = userKeywords.map(uk => uk.keyword_id);
            const { data: keywords, error: keywordDetailError } = await supabase
                .from('keyword')
                .select('keyword, category')
                .in('id', keywordIds);

            if (keywordDetailError) {
                console.error('키워드 상세 정보 조회 오류:', keywordDetailError);
                return res.status(500).json({
                    success: false,
                    error: '키워드 상세 정보를 가져오는데 실패했습니다.'
                });
            }

            if (keywords && keywords.length > 0) {
                keywordList = keywords.map(k => `${k.keyword}(${k.category})`).join(', ');
            }
        }

        // 4. 메시지 내용 구성
        const messageText = `[잡매칭 지원 알림]

새로운 지원자가 있습니다!

▶ 지원자 정보
• 이름: ${userProfile.name || '미입력'}
• 연락처: ${userProfile.phone_number || '미입력'}
• 이메일: ${userProfile.email || '미입력'}
• 비자: ${userProfile.visa || '미입력'}
• 거주지: ${userProfile.address || '미입력'}
• 한국어 수준: ${userProfile.korean_level || '미입력'}

▶ 관심 분야
${keywordList}

▶ 자기소개
${userProfile.description || '자기소개가 없습니다.'}

지원자와 연락을 원하시면 위 연락처로 연락 부탁드립니다.`;

        // 5. 메시지 전송
        const message = {
            to: company_number,
            from: process.env.SENDER_PHONE || '01036602129',
            text: messageText,
        };

        // 메시지 목록 그룹에 담기 (배열)
        const messageGroup = [message];

        try {
            // 메시지 그룹 발송 요청
            const result = await messageService.send(messageGroup);
            console.log('메시지 전송 성공:', result);

            // 6. 지원 기록 저장 (선택사항 - 추후 지원 내역 관리를 위해)
            // const { error: applicationError } = await supabase
            //   .from('applications')
            //   .insert({
            //     user_id: user_id,
            //     company_id: company_id,
            //     applied_at: new Date(),
            //     status: 'sent'
            //   });

            return res.json({
                success: true,
                message: '메시지가 성공적으로 전송되었습니다.',
                messageId: result.groupId
            });

        } catch (msgError) {
            console.error('메시지 전송 실패:', msgError);
            return res.status(500).json({
                success: false,
                error: '메시지 전송에 실패했습니다.',
                details: msgError.message
            });
        }

    } catch (error) {
        console.error('서버 오류:', error);
        return res.status(500).json({
            success: false,
            error: '서버 오류가 발생했습니다.'
        });
    }
});

// 구직자에게 메시지 전송 엔드포인트
app.post('/send-message-to-user', async (req, res) => {
    try {
        const { company_id, user_number } = req.body;

        // 입력 검증
        if (!company_id || !user_number) {
            return res.status(400).json({
                success: false,
                error: '필수 정보가 누락되었습니다.'
            });
        }

        // 1. 회사 프로필 정보 가져오기
        const { data: companyProfile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', company_id)
            .single();

        if (profileError || !companyProfile) {
            console.error('회사 정보 조회 오류:', profileError);
            return res.status(404).json({
                success: false,
                error: '회사 정보를 찾을 수 없습니다.'
            });
        }

        // 2. 회사가 선택한 키워드 가져오기
        const { data: companyKeywords, error: keywordError } = await supabase
            .from('company_keyword')
            .select('keyword_id')
            .eq('company_id', company_id);

        if (keywordError) {
            console.error('키워드 조회 오류:', keywordError);
            return res.status(500).json({
                success: false,
                error: '키워드 정보를 가져오는데 실패했습니다.'
            });
        }

        // 3. 키워드 정보 가져오기 (keyword 테이블에서)
        let keywordList = '미등록';

        if (companyKeywords && companyKeywords.length > 0) {
            const keywordIds = companyKeywords.map(ck => ck.keyword_id);
            const { data: keywords, error: keywordDetailError } = await supabase
                .from('keyword')
                .select('keyword, category')
                .in('id', keywordIds);

            if (keywordDetailError) {
                console.error('키워드 상세 정보 조회 오류:', keywordDetailError);
                return res.status(500).json({
                    success: false,
                    error: '키워드 상세 정보를 가져오는데 실패했습니다.'
                });
            }

            if (keywords && keywords.length > 0) {
                keywordList = keywords.map(k => `${k.keyword}(${k.category})`).join(', ');
            }
        }

        // 4. 메시지 내용 구성
        const messageText = `[잡매칭 관심 기업 알림]

귀하의 프로필에 관심있는 기업이 있습니다!

▶ 기업 정보
• 회사명: ${companyProfile.name || '미입력'}
• 연락처: ${companyProfile.phone_number || '미입력'}
• 이메일: ${companyProfile.email || '미입력'}
• 웹사이트: ${companyProfile.website || '미입력'}
• 주소: ${companyProfile.address || '미입력'}

▶ 채용 분야
${keywordList}

▶ 회사 소개
${companyProfile.description || '회사 소개가 없습니다.'}

관심이 있으시면 위 연락처로 연락 부탁드립니다.`;

        // 5. 메시지 전송
        const message = {
            to: user_number,
            from: process.env.SENDER_PHONE || '01036602129',
            text: messageText,
        };

        // 메시지 목록 그룹에 담기 (배열)
        const messageGroup = [message];

        try {
            // 메시지 그룹 발송 요청
            const result = await messageService.send(messageGroup);
            console.log('메시지 전송 성공:', result);

            // 6. 연락 기록 저장 (선택사항 - 추후 연락 내역 관리를 위해)
            // const { error: contactError } = await supabase
            //   .from('company_contacts')
            //   .insert({
            //     company_id: company_id,
            //     user_phone: user_number,
            //     contacted_at: new Date(),
            //     status: 'sent'
            //   });

            return res.json({
                success: true,
                message: '메시지가 성공적으로 전송되었습니다.',
                messageId: result.groupId
            });

        } catch (msgError) {
            console.error('메시지 전송 실패:', msgError);
            return res.status(500).json({
                success: false,
                error: '메시지 전송에 실패했습니다.',
                details: msgError.message
            });
        }

    } catch (error) {
        console.error('서버 오류:', error);
        return res.status(500).json({
            success: false,
            error: '서버 오류가 발생했습니다.'
        });
    }
});



// AI 키워드 추출 엔드포인트
app.post('/extract-keywords', async (req, res) => {
    try {
        const { company_id, job_description } = req.body;

        if (!company_id || !job_description) {
            return res.status(400).json({
                success: false,
                error: '필수 정보가 누락되었습니다.'
            });
        }

        // 1. 데이터베이스에서 모든 키워드 가져오기
        const { data: allKeywords, error: keywordError } = await supabase
            .from('keyword')
            .select('*');

        if (keywordError) {
            console.error('키워드 조회 오류:', keywordError);
            return res.status(500).json({
                success: false,
                error: '키워드 정보를 가져오는데 실패했습니다.'
            });
        }

        // 2. OpenAI API를 사용하여 키워드 추출
        const prompt = `
다음은 회사가 찾고 있는 인재상에 대한 설명입니다:
"${job_description}"

아래 키워드 목록에서 위 설명과 가장 관련성이 높은 키워드를 선택해주세요.
각 카테고리별로 최소 1개 이상 선택하되, 전체적으로 5-15개 사이로 선택해주세요.

사용 가능한 키워드:
${allKeywords.map(k => `- ${k.keyword} (${k.category})`).join('\n')}

선택한 키워드의 ID만 JSON 배열 형식으로 반환해주세요.
예시: [1, 5, 8, 12, 15]
`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                {
                    role: "system",
                    content: "당신은 채용 전문가입니다. 회사의 인재상 설명을 분석하여 가장 적합한 키워드를 선택하는 역할을 합니다."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.3,
        });

        // 3. AI 응답에서 키워드 ID 파싱
        const responseText = completion.choices[0].message.content;
        let selectedKeywordIds;

        try {
            // JSON 배열 추출
            const jsonMatch = responseText.match(/\[[\d,\s]+\]/);
            if (jsonMatch) {
                selectedKeywordIds = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('키워드 ID를 파싱할 수 없습니다.');
            }
        } catch (parseError) {
            console.error('파싱 오류:', parseError);
            return res.status(500).json({
                success: false,
                error: 'AI 응답을 처리하는데 실패했습니다.'
            });
        }

        // 4. 유효한 키워드 ID만 필터링
        const validKeywordIds = selectedKeywordIds.filter(id =>
            allKeywords.some(k => k.id === id)
        );

        // 5. 기존 company_keyword 삭제
        const { error: deleteError } = await supabase
            .from('company_keyword')
            .delete()
            .eq('company_id', company_id);

        if (deleteError) {
            console.error('기존 키워드 삭제 오류:', deleteError);
            return res.status(500).json({
                success: false,
                error: '기존 키워드 삭제에 실패했습니다.'
            });
        }

        // 6. 새로운 키워드 삽입
        if (validKeywordIds.length > 0) {
            const companyKeywords = validKeywordIds.map(keywordId => ({
                company_id: company_id,
                keyword_id: keywordId,
                priority: 2 // 기본값
            }));

            const { error: insertError } = await supabase
                .from('company_keyword')
                .insert(companyKeywords);

            if (insertError) {
                console.error('키워드 삽입 오류:', insertError);
                return res.status(500).json({
                    success: false,
                    error: '키워드 저장에 실패했습니다.'
                });
            }
        }

        // 7. 선택된 키워드 정보 반환
        const selectedKeywords = allKeywords.filter(k =>
            validKeywordIds.includes(k.id)
        );

        return res.json({
            success: true,
            message: '키워드가 성공적으로 추출되었습니다.',
            keywords: selectedKeywords,
            keywordIds: validKeywordIds
        });

    } catch (error) {
        console.error('서버 오류:', error);
        return res.status(500).json({
            success: false,
            error: '서버 오류가 발생했습니다.'
        });
    }
});



app.post('/extract-jobseeker-keywords', async (req, res) => {
    try {
        const { user_id, self_description } = req.body;

        if (!user_id || !self_description) {
            return res.status(400).json({
                success: false,
                error: '필수 정보가 누락되었습니다.'
            });
        }

        // 1. 데이터베이스에서 모든 키워드 가져오기
        const { data: allKeywords, error: keywordError } = await supabase
            .from('keyword')
            .select('*');

        if (keywordError) {
            console.error('키워드 조회 오류:', keywordError);
            return res.status(500).json({
                success: false,
                error: '키워드 정보를 가져오는데 실패했습니다.'
            });
        }

        // 2. 키워드 매칭을 위한 간단한 알고리즘
        const extractedKeywordIds = [];
        const descriptionLower = self_description.toLowerCase();

        // 키워드 매칭 규칙
        const keywordRules = {
            // 직무 관련
            '주방': ['요리', '조리', '주방', '쿠킹', '음식', '식당', 'kitchen', 'cook', 'chef'],
            '서빙': ['서빙', '홀', '서비스', '접객', '손님', 'serving', 'waiter', 'waitress'],
            '청소': ['청소', '정리', '위생', '깨끗', 'cleaning', 'clean'],
            '공장': ['공장', '제조', '생산', '작업', '라인', 'factory', 'manufacturing'],
            '건설': ['건설', '건축', '공사', '시공', 'construction', 'building'],
            '농업': ['농업', '농장', '농사', '재배', 'farming', 'agriculture'],
            '물류': ['물류', '배송', '택배', '운송', '창고', 'logistics', 'delivery'],
            '판매': ['판매', '영업', '매장', '마트', '편의점', 'sales', 'retail'],

            // 지역 관련
            '서울': ['서울', 'seoul'],
            '경기': ['경기', '수원', '안양', '부천', '안산', 'gyeonggi'],
            '인천': ['인천', 'incheon'],
            '부산': ['부산', 'busan'],
            '대구': ['대구', 'daegu'],
            '광주': ['광주', 'gwangju'],
            '대전': ['대전', 'daejeon'],

            // 혜택 관련
            '기숙사': ['기숙사', '숙소', '숙박', '주거', '거주', 'dormitory', 'accommodation'],
            '식사제공': ['식사', '밥', '급식', '음식제공', 'meal', 'food'],
            '교통비': ['교통', '통근', '차비', 'transportation', 'commute'],
            '보너스': ['보너스', '상여', '인센티브', 'bonus', 'incentive'],
            '4대보험': ['보험', '4대보험', '사대보험', 'insurance'],
            '주5일': ['주5일', '주 5일', '평일', 'weekday', '5 days'],
            '주말휴무': ['주말', '휴무', '토일', 'weekend', 'holiday'],
            '야간근무': ['야간', '밤', '저녁', '새벽', 'night', 'evening'],

            // 경험/스킬 관련
            '경력무관': ['초보', '신입', '무관', '경험없', 'beginner', 'no experience'],
            '경력우대': ['경력', '경험', '숙련', 'experience', 'skilled'],
            '한국어가능': ['한국어', '한국말', 'korean'],
            '영어가능': ['영어', 'english'],
            '컴퓨터활용': ['컴퓨터', '엑셀', 'computer', 'excel'],
            '운전가능': ['운전', '면허', 'driving', 'license'],

            '단기': ['단기', '1개월', '2개월', '3개월', '일시', '임시', 'short', 'temporary', 'temp'],
            '중기': ['중기', '6개월', '반년', '4개월', '5개월', 'medium'],
            '장기': ['장기', '1년', '정규직', '오래', '계속', 'long', 'permanent', 'full-time'],
            '일용직': ['일당', '일용', '하루', '일일', 'daily', 'day'],
            '계약직': ['계약', '기간', '프로젝트', 'contract', 'project'],
            '정규직': ['정규', '정직원', '무기', 'permanent', 'regular']
        };

        // 키워드 매칭
        allKeywords.forEach(keyword => {
            const rules = keywordRules[keyword.keyword];
            if (rules) {
                const hasMatch = rules.some(rule => descriptionLower.includes(rule));
                if (hasMatch) {
                    extractedKeywordIds.push(keyword.id);
                }
            }
        });

        // 카테고리별 최소 선택 보장
        const categories = ['직무', '지역', '혜택', '근무기간'];
        const selectedByCategory = {};

        allKeywords.forEach(keyword => {
            if (!selectedByCategory[keyword.category]) {
                selectedByCategory[keyword.category] = [];
            }
            if (extractedKeywordIds.includes(keyword.id)) {
                selectedByCategory[keyword.category].push(keyword);
            }
        });

        // 각 카테고리에서 최소 1개는 선택되도록
        categories.forEach(category => {
            if (!selectedByCategory[category] || selectedByCategory[category].length === 0) {
                // 해당 카테고리에서 가장 일반적인 키워드 추가
                const categoryKeywords = allKeywords.filter(k => k.category === category);
                if (categoryKeywords.length > 0) {
                    // 기본 키워드 추가 (예: 직무-경력무관, 지역-서울, 혜택-4대보험)
                    const defaultKeywords = {
                        '직무': '경력무관',
                        '지역': '서울',
                        '혜택': '4대보험',
                        '근무기간': '장기'
                    };

                    const defaultKeyword = categoryKeywords.find(k =>
                        k.keyword === defaultKeywords[category]
                    );

                    if (defaultKeyword && !extractedKeywordIds.includes(defaultKeyword.id)) {
                        extractedKeywordIds.push(defaultKeyword.id);
                    }
                }
            }
        });

        // 3. 기존 user_keyword 삭제
        const { error: deleteError } = await supabase
            .from('user_keyword')
            .delete()
            .eq('user_id', user_id);

        if (deleteError) {
            console.error('기존 키워드 삭제 오류:', deleteError);
            return res.status(500).json({
                success: false,
                error: '기존 키워드 삭제에 실패했습니다.'
            });
        }

        // 4. 새로운 키워드 삽입
        if (extractedKeywordIds.length > 0) {
            const userKeywords = extractedKeywordIds.map(keywordId => ({
                user_id: user_id,
                keyword_id: keywordId,
                priority: 2 // 기본값
            }));

            const { error: insertError } = await supabase
                .from('user_keyword')
                .insert(userKeywords);

            if (insertError) {
                console.error('키워드 삽입 오류:', insertError);
                return res.status(500).json({
                    success: false,
                    error: '키워드 저장에 실패했습니다.'
                });
            }
        }

        // 5. profiles 테이블에 자기소개 업데이트
        const { error: profileUpdateError } = await supabase
            .from('profiles')
            .update({ description: self_description })
            .eq('id', user_id);

        if (profileUpdateError) {
            console.error('프로필 업데이트 오류:', profileUpdateError);
            // 에러가 있어도 키워드는 저장되었으므로 계속 진행
        }

        // 6. 선택된 키워드 정보 반환
        const selectedKeywords = allKeywords.filter(k =>
            extractedKeywordIds.includes(k.id)
        );

        return res.json({
            success: true,
            message: '키워드와 자기소개가 성공적으로 저장되었습니다.',
            keywords: selectedKeywords,
            keywordIds: extractedKeywordIds
        });

    } catch (error) {
        console.error('서버 오류:', error);
        return res.status(500).json({
            success: false,
            error: '서버 오류가 발생했습니다.'
        });
    }
});



// AI 이력서 생성 엔드포인트
app.post('/generate-resume', async (req, res) => {
    try {
        const { user_id, company_id } = req.body;

        if (!user_id || !company_id) {
            return res.status(400).json({
                success: false,
                error: '필수 정보가 누락되었습니다.'
            });
        }

        // 1. 유저 프로필 정보 가져오기
        const { data: userProfile, error: userError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user_id)
            .single();

        if (userError || !userProfile) {
            return res.status(404).json({
                success: false,
                error: '유저 정보를 찾을 수 없습니다.'
            });
        }

        // 2. user_info 테이블에서 추가 정보 가져오기
        const { data: userInfo, error: userInfoError } = await supabase
            .from('user_info')
            .select('*')
            .eq('user_id', user_id)
            .single();

        // user_info가 없어도 계속 진행 (선택적 정보)
        if (userInfoError) {
            console.log('user_info 조회 실패 또는 데이터 없음:', userInfoError);
        }

        // 3. 유저 키워드 정보 가져오기
        const { data: userKeywords, error: keywordError } = await supabase
            .from('user_keyword')
            .select(`
                keyword:keyword_id (
                    keyword,
                    category
                )
            `)
            .eq('user_id', user_id);

        if (keywordError) {
            console.error('키워드 조회 오류:', keywordError);
        }

        // 4. 회사 정보 가져오기
        const { data: companyProfile, error: companyError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', company_id)
            .single();

        if (companyError || !companyProfile) {
            return res.status(404).json({
                success: false,
                error: '회사 정보를 찾을 수 없습니다.'
            });
        }

        // 5. 회사 키워드 정보 가져오기
        const { data: companyKeywords, error: companyKeywordError } = await supabase
            .from('company_keyword')
            .select(`
                keyword:keyword_id (
                    keyword,
                    category
                )
            `)
            .eq('company_id', company_id);

        // 6. 키워드 정리
        const userJobKeywords = userKeywords?.filter(k => k.keyword.category === '직종').map(k => k.keyword.keyword) || [];
        const userConditionKeywords = userKeywords?.filter(k => k.keyword.category === '근무조건').map(k => k.keyword.keyword) || [];
        const companyJobKeywords = companyKeywords?.filter(k => k.keyword.category === '직종').map(k => k.keyword.keyword) || [];
        const companyConditionKeywords = companyKeywords?.filter(k => k.keyword.category === '근무조건').map(k => k.keyword.keyword) || [];

        // 7. AI 프롬프트 생성
        const prompt = `
다음 정보를 바탕으로 외국인 구직자가 한국 회사에 보내는 자기소개서를 작성해주세요.

[지원자 정보]
- 이름: ${userProfile.name || '지원자'}
- 나이: ${userInfo?.age || userProfile.age || '미입력'}
- 성별: ${userInfo?.gender || userProfile.gender || '미입력'}
- 국적: ${userInfo?.nationality || userKeywords?.find(k => k.keyword.category === '국가')?.keyword.keyword || '미입력'}
- 비자: ${userInfo?.visa || userProfile.visa || '미입력'}
- 비자 만료일: ${userInfo?.visa_expiry_date || '미입력'}
- 한국어 수준: ${userInfo?.korean_level || userProfile.korean_level || '미입력'}
- 경력: ${userInfo?.experience || userProfile.experience || '미입력'}
- 한국 거주 기간: ${userInfo?.how_long || userProfile.how_long || '미입력'}
- 학력: ${userInfo?.education || '미입력'}
- 운전면허: ${userInfo?.has_license ? '있음' : '없음'}
- 차량 소유: ${userInfo?.has_car ? '있음' : '없음'}
- 자기소개: ${userProfile.description || ''}
- 희망 직종: ${userJobKeywords.join(', ') || '미입력'}
- 희망 근무조건: ${userConditionKeywords.join(', ') || '미입력'}

[회사 정보]
- 회사명: ${companyProfile.name}
- 주소: ${companyProfile.address || '미입력'}
- 회사 소개: ${companyProfile.description || ''}
- 채용 직종: ${companyJobKeywords.join(', ') || '미입력'}
- 제공 조건: ${companyConditionKeywords.join(', ') || '미입력'}

[매칭 분석]
- 회사가 ${companyJobKeywords.join(', ')} 직종을 채용하고 있습니다.
- 지원자는 ${userJobKeywords.join(', ')} 직종을 희망합니다.
- 회사 업종과 지원자 경력의 연관성을 찾아 강조하세요.

작성 가이드라인:
1. 친근하고 정중한 어투로 작성하세요.
2. "안녕하세요, [회사명] 사장님"으로 시작하세요.
3. 지원자의 강점을 구체적으로 어필하세요.
4. 경력이나 특기가 회사의 채용 직종과 연관되면 강조하세요.
5. 회사가 제공하는 조건과 지원자가 원하는 조건이 맞으면 언급하세요.
6. 300-400자 정도로 작성하세요.
7. 문단을 적절히 나누어 읽기 쉽게 작성하세요.
8. 진정성 있고 열정적인 태도를 보여주세요.

예시 형식:
안녕하세요, [회사명] 사장님.

저는 [나이]살 [국적] 출신으로, 한국에서 일할 준비가 되어있는 [이름]입니다. 
현재 [비자] 비자를 보유하고 있으며, [희망근무기간]을 희망합니다.

[경력 및 강점 소개 - 회사 업종과 연관지어서]

[개인의 성격적 강점이나 특기]

[회사에 대한 관심과 일하고 싶은 이유]

성실하고 책임감 있게 일하겠습니다. 면접 기회를 주시면 감사하겠습니다.
`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                {
                    role: "system",
                    content: "당신은 외국인 구직자를 돕는 전문 이력서 작성자입니다. 한국 회사 문화를 잘 이해하고 있으며, 진정성 있고 호감을 주는 자기소개서를 작성합니다. 회사의 니즈와 지원자의 강점을 잘 매칭시켜 작성합니다."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.7,
            max_tokens: 1000
        });

        const resume = completion.choices[0].message.content;

        return res.json({
            success: true,
            resume: resume,
            userProfile: {
                name: userProfile.name || userInfo?.name || '지원자',
                phone: userProfile.phone_number
            },
            companyName: companyProfile.name
        });

    } catch (error) {
        console.error('이력서 생성 오류:', error);
        return res.status(500).json({
            success: false,
            error: '이력서 생성 중 오류가 발생했습니다.'
        });
    }
});

// 헬스 체크 엔드포인트
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

const PORT = process.env.PORT || 5004;
app.listen(PORT, () => {
    console.log(`Listening on ${PORT}`);
});