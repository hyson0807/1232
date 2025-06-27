import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());



const supabase = createClient(
    process.env.KEY_1,
    process.env.KEY_2,
)

const twilio = require('twilio');
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);


app.get('/', (req, res) => {
    res.json({ message: 'Server is running' });
});

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
        console.error('Sginup error:', error)
        return res.status(500).json({
            error: '서버오류(회원가입 실패)'
        })
    }
});


//---------------------------------phone verify---------------------------------------

// 인증 코드 전송
app.post('/send-verification', async (req, res) => {
    const { phoneNumber } = req.body;

    try {
        const verification = await client.verify.v2
            .services(process.env.TWILIO_VERIFY_SERVICE_SID)
            .verifications
            .create({ to: `+82${phoneNumber}`, channel: 'sms' });

        res.json({ success: true, status: verification.status });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// 인증 코드 확인
app.post('/verify-code', async (req, res) => {
    const { phoneNumber, code } = req.body;

    try {
        const verification = await client.verify.v2
            .services(process.env.TWILIO_VERIFY_SERVICE_SID)
            .verificationChecks
            .create({ to: `+82${phoneNumber}`, code });

        res.json({ success: verification.status === 'approved' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// 전화번호로 로그인
app.post('/signin-phone', async (req, res) => {
    const { phoneNumber, userType } = req.body;

    // Supabase에서 전화번호로 사용자 조회
    // 있으면 로그인, 없으면 에러
});

// 전화번호로 회원가입
app.post('/signup-phone', async (req, res) => {
    const { phoneNumber, userType } = req.body;

    // Supabase에 새 사용자 생성
    // 전화번호를 unique identifier로 사용
});



const PORT = process.env.PORT || 5004;
app.listen(PORT, () => {
    console.log(`Listening on ${PORT}`);
})