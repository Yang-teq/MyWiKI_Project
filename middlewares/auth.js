const Document = require('../models/Document');

async function checkDocAccess(req, res, next) {
    try {
        const title = decodeURIComponent(req.params.encodedTitle);
        const doc = await Document.findOne({ title });

        // 문서가 있고 프라이빗 상태일 때
        if (doc && doc.isPrivate) {
            // [수정 핵심] 비밀번호가 설정된 문서라면 미들웨어에서 막지 않고 통과시킴
            // (비밀번호 확인은 views/views.ejs와 /wiki/verify 라우트에서 처리함)
            if (doc.password && doc.password.length > 0) {
                return next();
            }

            // 비밀번호가 없는 일반 프라이빗 문서인 경우에만 기존 권한 검사 수행
            if (!req.user) return res.status(401).send('로그인이 필요합니다.');

            const isAuthorized = doc.author.equals(req.user._id) ||
                (doc.allowedUsers && doc.allowedUsers.includes(req.user._id));

            if (!isAuthorized) return res.status(403).send('접근 권한이 없습니다.');
        }

        next();
    } catch (err) {
        console.error('권한 검사 오류:', err);
        res.status(500).send('서버 오류');
    }
}
module.exports = { checkDocAccess };