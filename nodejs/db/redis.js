const Redis = require('ioredis');

console.log(process.env.NETWORK)

// 配置 Redis 客户端
const redisClient = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
});

module.exports = redisClient;