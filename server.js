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
            user_type: user_type
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



const PORT = process.env.PORT || 5004;
app.listen(PORT, () => {
    console.log(`Listening on ${PORT}`);
})