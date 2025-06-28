import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import pkg from 'solapi';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const { SolapiMessageService } = pkg;

// Supabase 클라이언트
const supabase = createClient(process.env.KEY_1, process.env.KEY_2,)

const messageService = new SolapiMessageService(process.env.SOLAPI_API_KEY, process.env.SOLAPI_API_SECRET);




app.get('/', (req, res) => {
    res.json({ message: 'Server is running' });
});

// 기존 이메일 회원가입 엔드포인트
app.post('/signup', async (req, res) => {
    try {
        const { email, password, user_type } = req.body

        if(!email || !password || !user_type) {
            return res.status(400).json({
                error: '필수정보누락(email||password||user_type)'
            })
        }

        const {error: authError, data: authData} = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
        })

        if(authError) {
            return res.status(400).json({
                error: authError.message
            })
        } else console.log("Auth signup successful")

        const {error: profilesError} = await supabase.from("profiles").insert({
            id: authData.user.id,
            user_type: user_type,
            email: email,
            auth_method: 'email' // 인증 방식 추가
        })

        if(profilesError) {
            await supabase.auth.admin.deleteUser(authData.user.id)
            return res.status(500).json({
                error: '프로필 생성 실패'
            })
        }

        return res.status(201).json({
            success: true,
            user: {
                auth_id: authData.user.id,
                user_type: user_type
            }
        })

    } catch (error) {
        console.error('Signup error:', error)
        return res.status(500).json({
            error: '서버오류(회원가입 실패)'
        })
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
            return res.status(500).json({
                success: false,
                error: '키워드 정보를 가져오는데 실패했습니다.'
            });
        }

        // 3. 키워드 정보 가져오기 (keyword 테이블에서)
        const keywordIds = userKeywords.map(uk => uk.keyword_id);
        const { data: keywords, error: keywordDetailError } = await supabase
            .from('keyword')
            .select('keyword, category')
            .in('id', keywordIds);

        if (keywordDetailError) {
            console.error('키워드 상세 정보 조회 오류:', keywordDetailError);
        }

        // 4. 메시지 내용 구성
        const keywordList = keywords && keywords.length > 0
            ? keywords.map(k => `${k.keyword}(${k.category})`).join(', ')
            : userKeywords.map(k => keywordMap[k.keyword_id] || `키워드${k.keyword_id}`).join(', ');

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
            // 문자 내용
            text: messageText,
            // 수신번호 (문자 받는 이)
            to: company_number,
            // 발신번호 (문자 보내는 이)
            from: process.env.SENDER_PHONE || '01036602129'
        };

        // 메시지 목록 그룹에 담기 (배열)
        const messageGroup = [message];

        try {
            // 메시지 그룹 발송 요청
            const result = await messageService.sendMany(messageGroup);
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
                error: '메시지 전송에 실패했습니다.'
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



const PORT = process.env.PORT || 5004;
app.listen(PORT, () => {
    console.log(`Listening on ${PORT}`);
})