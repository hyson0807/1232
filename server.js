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
const messageService = new SolapiMessageService(process.env.SOLAPI_API_KEY, process.env.SOLAPI_API_SECRET);

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

app.get('/', (req, res) => {
    res.json({ message: 'Server is running' });
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



// 헬스 체크 엔드포인트
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

const PORT = process.env.PORT || 5004;
app.listen(PORT, () => {
    console.log(`Listening on ${PORT}`);
});