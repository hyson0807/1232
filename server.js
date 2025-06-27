import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Supabase 클라이언트
const supabase = createClient(
    process.env.KEY_1,
    process.env.KEY_2,
)

// Twilio 클라이언트
const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// 전화번호 포맷팅 함수
const formatPhoneNumber = (phoneNumber) => {
    // 0으로 시작하는 한국 번호를 국제 형식으로 변환
    if (phoneNumber.startsWith('0')) {
        return `+82${phoneNumber.substring(1)}`;
    }
    return phoneNumber;
};

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

// Twilio 인증 코드 전송 엔드포인트
app.post('/send-verification', async (req, res) => {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
        return res.status(400).json({
            success: false,
            message: '전화번호가 필요합니다.'
        });
    }

    try {
        const verification = await twilioClient.verify.v2
            .services(process.env.TWILIO_VERIFY_SERVICE_SID)
            .verifications
            .create({
                to: formatPhoneNumber(phoneNumber),
                channel: 'sms',
                locale: 'ko' // 한국어 메시지
            });

        res.json({
            success: true,
            status: verification.status
        });
    } catch (error) {
        console.error('Twilio verification error:', error);
        res.status(400).json({
            success: false,
            message: '인증 코드 전송에 실패했습니다.'
        });
    }
});

// 인증 코드 확인 엔드포인트
app.post('/verify-code', async (req, res) => {
    const { phoneNumber, code } = req.body;

    if (!phoneNumber || !code) {
        return res.status(400).json({
            success: false,
            message: '전화번호와 인증 코드가 필요합니다.'
        });
    }

    try {
        const verificationCheck = await twilioClient.verify.v2
            .services(process.env.TWILIO_VERIFY_SERVICE_SID)
            .verificationChecks
            .create({
                to: formatPhoneNumber(phoneNumber),
                code: code
            });

        res.json({
            success: verificationCheck.status === 'approved',
            status: verificationCheck.status
        });
    } catch (error) {
        console.error('Twilio verification check error:', error);
        res.status(400).json({
            success: false,
            message: '인증 코드가 올바르지 않습니다.'
        });
    }
});

// 전화번호로 로그인 엔드포인트
app.post('/signin-phone', async (req, res) => {
    const { phoneNumber, userType } = req.body;

    if (!phoneNumber || !userType) {
        return res.status(400).json({
            success: false,
            message: '전화번호와 유저 타입이 필요합니다.'
        });
    }

    try {
        // profiles 테이블에서 전화번호로 사용자 조회
        const { data: user, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('phone_number', phoneNumber)
            .eq('user_type', userType)
            .single();

        if (error || !user) {
            return res.status(404).json({
                success: false,
                message: '등록되지 않은 사용자입니다.'
            });
        }

        // 로그인 성공
        res.json({
            success: true,
            user: {
                id: user.id,
                phone_number: user.phone_number,
                user_type: user.user_type,
                email: user.email,
                name: user.name,
                created_at: user.created_at
            }
        });
    } catch (error) {
        console.error('Phone signin error:', error);
        res.status(500).json({
            success: false,
            message: '로그인 처리 중 오류가 발생했습니다.'
        });
    }
});

// 전화번호로 회원가입 엔드포인트
app.post('/signup-phone', async (req, res) => {
    const { phoneNumber, userType } = req.body;

    if (!phoneNumber || !userType) {
        return res.status(400).json({
            success: false,
            message: '전화번호와 유저 타입이 필요합니다.'
        });
    }

    try {
        // 기존 사용자 확인
        const { data: existingUser } = await supabase
            .from('profiles')
            .select('id')
            .eq('phone_number', phoneNumber)
            .single();

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: '이미 등록된 전화번호입니다.'
            });
        }

        // UUID 생성
        const userId = uuidv4();

        // profiles 테이블에 사용자 정보 저장 (Auth 없이)
        const { data: newUser, error: profileError } = await supabase
            .from('profiles')
            .insert({
                id: userId,
                phone_number: phoneNumber,
                user_type: userType,
                auth_method: 'phone',
                created_at: new Date().toISOString()
            })
            .select()
            .single();

        if (profileError) {
            console.error('Profile creation error:', profileError);
            throw profileError;
        }

        res.json({
            success: true,
            user: {
                id: newUser.id,
                phone_number: newUser.phone_number,
                user_type: newUser.user_type,
                created_at: newUser.created_at
            }
        });
    } catch (error) {
        console.error('Phone signup error:', error);
        res.status(500).json({
            success: false,
            message: '회원가입 처리 중 오류가 발생했습니다.'
        });
    }
});

const PORT = process.env.PORT || 5004;
app.listen(PORT, () => {
    console.log(`Listening on ${PORT}`);
})