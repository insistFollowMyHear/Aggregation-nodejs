var express = require('express');
var router = express.Router();
const userController = require('../controllers/userController');
const jwt = require('jsonwebtoken');
const secretKey = '@g%!f98RlU^&4n-7';


const verifyToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];  // 从 "Authorization: Bearer <token>" 中提取 token
    if (!token) {
        return res.status(403).json({ message: 'No token provided' });
    }

    jwt.verify(token, secretKey, (err, decoded) => {
        if (err) {
            return res.status(401).json({ message: 'Invalid or expired token' });
        }
        req.user = decoded;  // 将解码后的信息附加到请求对象上
        next();
    });
};

const payload = { userId: 'example_user', role: 'admin' };

// 生成一个有效期为 1 小时的 Token
const token = jwt.sign(payload, secretKey, { expiresIn: '1h' });

console.log('Generated Token:', token);

router.post('/buy', userController.Buy);
router.post('/sell', userController.Sell);
router.post('/pair', userController.SetPair);
router.get('/tokens', userController.GetTokens);
router.get('/pools', userController.GetPools);
router.get('/pair', userController.GetPair);
router.get('/price', userController.GetPrice);
router.get('/log', userController.GetLog);

module.exports = router;