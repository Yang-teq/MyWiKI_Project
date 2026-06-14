const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { marked } = require('marked');
const { OpenAI } = require('openai');

// 모델 및 미들웨어 불러오기
const Document = require('./models/Document');
const User = require('./models/User');
const Revision = require('./models/Revision');
const Room = require('./models/Room');
const { checkDocAccess } = require('./middlewares/auth');

const app = express();
const PORT = 3000;

// 설정
require('dotenv').config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

// --- 설정 및 미들웨어 ---
app.set('view engine', 'ejs');
app.set('views', './views');
app.use(express.static('public'));
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: 'my-wiki-secret-key',
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
    res.locals.user = req.user || null;
    next();
});

// --- Passport 인증 ---
passport.use(new LocalStrategy(async (username, password, done) => {
    try {
        const user = await User.findOne({ username });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return done(null, false, { message: '아이디 또는 비밀번호가 틀렸습니다.' });
        }
        return done(null, user);
    } catch (err) { return done(err); }
}));
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
    try { const user = await User.findById(id); done(null, user); }
    catch (err) { done(err); }
});

function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.render('login_required');
}

// --- 유틸리티 함수 ---
async function getNaverNews() {
    try {
        const response = await axios.get('https://openapi.naver.com/v1/search/news.json', {
            params: { query: '실시간', display: 5 },
            headers: { 'X-Naver-Client-Id': NAVER_CLIENT_ID, 'X-Naver-Client-Secret': NAVER_CLIENT_SECRET }
        });
        return response.data.items;
    } catch (e) { return []; }
}

// --- 수정된 라우터 (페이지네이션 적용) ---
app.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1; // 현재 페이지 (기본 1)
        const limit = 10; // 한 페이지당 보여줄 문서 수
        const skip = (page - 1) * limit;

        // 필터 조건: 삭제되지 않았고, 일반 문서(roomId가 없거나 null)
        const filter = { 
            isDeleted: { $ne: true },
            $or: [ { roomId: { $exists: false } }, { roomId: null } ] 
        };

        // 전체 문서 개수 계산 (페이지 계산용)
        const totalDocs = await Document.countDocuments(filter);
        const totalPages = Math.ceil(totalDocs / limit);

        // 현재 페이지의 데이터만 가져오기
        const docs = await Document.find(filter)
            .sort({ lastModified: -1 })
            .skip(skip)
            .limit(limit);

        console.log('현재 페이지:', page, '전체 페이지:', totalPages, '문서 개수:', docs.length);
        
        res.render('index', { 
            docs, 
            news: await getNaverNews(),
            currentPage: page,
            totalPages: totalPages
        });
    } catch (err) { 
        console.error(err);
        res.status(500).send('페이지 로드 실패'); 
    }
});

// 네이버 검색 엔진을 통한 마크다운 형식 변환 엔진
app.post('/generate-wiki', async (req, res) => {
    const { title, draftContent } = req.body;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ 
                role: "user", 
                content: `
                    아래 내용을 나무위키 스타일로 정리해줘.
                    1. 내용을 절대 새로 창작하거나 지어내지 마.
                    2. 마크다운 형식으로 '개요', '특징', '여담' 섹션을 나눠서 작성해.
                    3. 문체는 나무위키 스타일(평어체)로 바꿔줘.
                    
                    제목: ${title}
                    내용: ${draftContent}
                ` 
            }],
        });
        
        res.json({ content: completion.choices[0].message.content });
    } catch (err) { 
        res.status(500).json({ error: 'AI 포장 실패' }); 
    }
});

// 인증 관련 라우트
app.get('/register', (req, res) => res.render('register'));
app.post('/register', async (req, res) => {
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    const user = await new User({ username: req.body.username, password: hashedPassword }).save();
    res.render('register_success', { username: user.username });
});
app.get('/login', (req, res) => res.render('login'));
app.post('/login', passport.authenticate('local', { successRedirect: '/', failureRedirect: '/login' }));
app.get('/logout', (req, res) => { req.logout(() => res.redirect('/')); });

// 편집 및 저장 라우트
app.get('/edit', isAuthenticated, async (req, res) => {
    const roomId = req.query.roomId; // 룸 ID 전달받음
    const news = await getNaverNews();
    res.render('edit', { doc: null, news, roomId, isPrivateMode: false });
});

// 프라이빗 문서 작성 페이지 라우트
app.get('/edit-private', isAuthenticated, async (req, res) => {
    // roomId가 쿼리로 넘어왔다면 그 룸에 소속된 문서를 작성하게 함
    const roomId = req.query.roomId;
    const news = await getNaverNews();
    res.render('edit', { doc: null, news, roomId, isPrivateMode: true }); 
});

app.get('/edit/:encodedTitle', isAuthenticated, async (req, res) => {
    try {
        const title = decodeURIComponent(req.params.encodedTitle); // 디코딩
        const doc = await Document.findOne({ title: title });
        if (!doc) return res.status(404).send('문서를 찾을 수 없습니다.');
        
        const news = await getNaverNews();
        res.render('edit', { doc, news, roomId: doc.roomId }); // roomId도 전달
    } catch (err) {
        res.status(500).send('서버 오류');
    }
});

// 비밀번호 암호화, 룸 기능, 프라이빗 설정, 히스토리 저장
app.post('/save', isAuthenticated, async (req, res) => {
    const { title, content, roomId, password } = req.body; 
    
    // 1. 기존 문서 찾기
    let doc = await Document.findOne({ title });

    // 2. 문서가 존재할 경우 업데이트, 없을 경우 새로 생성
    if (doc) {
        doc.content = content;
        doc.lastModified = new Date();
        // 참고: 마지막 수정자 기록을 위해 author 업데이트 (원하시면 유지 가능)
        doc.author = req.user._id; 
        
        // 비밀번호가 새로 들어왔을 때만 업데이트
        if (password && password.trim() !== "") {
            doc.password = await bcrypt.hash(password, 10);
        }
        await doc.save();
    } else {
        // 새로 생성 시 로직
        const newDocData = {
            title,
            content,
            lastModified: new Date(),
            author: req.user._id,
            isPrivate: (password && password.trim() !== ""), // 비밀번호 있으면 프라이빗
            roomId: roomId || null,
            isDeleted: false
        };
        
        if (password && password.trim() !== "") {
            newDocData.password = await bcrypt.hash(password, 10);
        }
        
        doc = await new Document(newDocData).save();
    }

    // [추가할 코드] 룸 멤버라면 비밀번호 없이 바로 볼 수 있도록 세션에 등록
    if (roomId) {
        const room = await Room.findById(roomId);
        if (room && room.members.includes(req.user._id)) {
            if (!req.session.authorizedDocs) req.session.authorizedDocs = [];
            if (!req.session.authorizedDocs.includes(doc._id.toString())) {
                req.session.authorizedDocs.push(doc._id.toString());
            }
        }
    }

    // 3. 히스토리(Revision) 기록 (공동 편집의 핵심)
    // 누가 언제 어떤 내용을 썼는지 남깁니다.
    await new Revision({ 
        documentId: doc._id, 
        editor: req.user._id, 
        content: content,
        timestamp: new Date()
    }).save();
    
    // 4. 저장 후 리다이렉트
    if (roomId) {
        res.redirect('/room/' + roomId);
    } else {
        res.redirect('/wiki/' + encodeURIComponent(title));
    }
});

//
app.post('/wiki/verify/:encodedTitle', async (req, res) => {
    const title = decodeURIComponent(req.params.encodedTitle);
    const doc = await Document.findOne({ title: title });
    
    // 비밀번호 비교 (bcrypt 사용)
    const isMatch = await bcrypt.compare(req.body.password, doc.password);
    
    if (isMatch) {
        if (!req.session.authorizedDocs) req.session.authorizedDocs = [];
        req.session.authorizedDocs.push(doc._id.toString());
        res.redirect('/wiki/' + encodeURIComponent(title));
    } else {
        res.send('<script>alert("비밀번호가 틀렸습니다."); history.back();</script>');
    }
});

// 문서 보기 및 삭제
app.get('/wiki/:encodedTitle', async (req, res) => {
    const title = decodeURIComponent(req.params.encodedTitle);
    const doc = await Document.findOne({ title: title });
    if (!doc) return res.send('문서가 없습니다.');

    // 세션에 인증 정보가 있는지 확인
    const isAuthorized = req.session.authorizedDocs?.includes(doc._id.toString());
    
    const revisions = await Revision.find({ documentId: doc._id }).populate('editor').sort({ createdAt: -1 });
    
    res.render('views', { 
        doc, 
        htmlContent: marked.parse(doc.content), 
        revisions, 
        news: await getNaverNews(),
        isAuthorized: isAuthorized 
    });
});

app.get('/delete/:encodedTitle', isAuthenticated, async (req, res) => {
    try {
        const title = decodeURIComponent(req.params.encodedTitle);
        
        // 1. 삭제하기 전에 해당 문서를 먼저 찾습니다.
        const doc = await Document.findOne({ title: title });
        
        // 문서가 없으면 바로 종료
        if (!doc) {
            return res.status(404).send('문서를 찾을 수 없습니다.');
        }

        // 2. 문서의 isDeleted를 true로 변경합니다.
        await Document.findOneAndUpdate({ title: title }, { isDeleted: true });

        // 3. 삭제 후 리다이렉트: 룸 소속이면 룸 페이지로, 아니면 홈으로!
        if (doc.roomId) {
            res.redirect('/room/' + doc.roomId);
        } else {
            res.redirect('/');
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('삭제 중 오류가 발생했습니다.');
    }
});

app.get('/trash', isAuthenticated, async (req, res) => {
    const trashedDocs = await Document.find({ isDeleted: true });
    res.render('trash', { docs: trashedDocs });
});

app.post('/trash/empty', isAuthenticated, async (req, res) => {
    await Document.deleteMany({ isDeleted: true });
    res.redirect('/trash');
});

// 프라이빗 룸 라우트 
app.get('/rooms', isAuthenticated, async (req, res) => {
    const rooms = await Room.find({ members: req.user._id });
    res.render('rooms', { rooms });
});

app.post('/room/create', isAuthenticated, async (req, res) => {
    const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    await new Room({ name: req.body.name, inviteCode, admin: req.user._id, members: [req.user._id] }).save();
    res.redirect('/rooms');
});

app.post('/room/join', isAuthenticated, async (req, res) => {
    const room = await Room.findOne({ inviteCode: req.body.inviteCode });
    if (!room) return res.status(404).send('존재하지 않는 초대 코드입니다.');
    if (!room.members.includes(req.user._id)) {
        room.members.push(req.user._id);
        await room.save();
    }
    res.redirect(`/room/${room._id}`);
});

app.get('/room/:roomId', isAuthenticated, async (req, res) => {
    try {
        const room = await Room.findById(req.params.roomId);
        if (!room || !room.members.includes(req.user._id)) return res.status(403).send('접근 권한이 없습니다.');
        const docs = await Document.find({ roomId: req.params.roomId, isDeleted: { $ne: true } });
        res.render('room_detail', { room, docs });
    } catch (err) { res.status(500).send('룸 정보를 불러올 수 없습니다.'); }
});

// DB 연결
mongoose.connect('mongodb://127.0.0.1:27017/namu_wiki_db')
    .then(() => {
        console.log('MongoDB 연결 성공!');
        app.listen(PORT, () => console.log(`Server: http://localhost:${PORT}`));
    })
    .catch(err => console.log('DB 연결 실패:', err));