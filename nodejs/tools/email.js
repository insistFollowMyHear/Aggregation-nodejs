const { Resend } = require('resend');
const { logInfoWithTimestamp, logErrWithTimestamp } = require('./log');

// 初始化 Resend 客户端
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * 发送邮件
 * @param {string} subject - 邮件主题
 * @param {string} content - 邮件内容
 * @param {string[]} [to=process.env.ALERT_EMAIL] - 收件人邮箱，默认使用环境变量中的告警邮箱
 * @returns {Promise<boolean>} 发送是否成功
 */
async function sendEmail(subject, content, to = process.env.ALERT_EMAIL) {
    try {
        const { data, error } = await resend.emails.send({
            from: 'process.env.RESEND_FROM_EMAIL',
            to: to,
            subject: subject,
            html: content,
            text: content.replace(/<[^>]*>/g, '') // 移除 HTML 标签，生成纯文本版本
        });

        if (error) {
            logErrWithTimestamp('邮件发送失败:', error);
            return false;
        }

        logInfoWithTimestamp(`邮件发送成功: ${data.id}`);
        return true;
    } catch (error) {
        logErrWithTimestamp('邮件发送失败:', error);
        return false;
    }
}

/**
 * 发送告警邮件
 * @param {string} title - 告警标题
 * @param {Object} data - 告警数据
 * @returns {Promise<boolean>} 发送是否成功
 */
async function sendAlertEmail(title, data) {
    const subject = `[告警] ${title}`;
    const content = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #e74c3c; margin-bottom: 20px;">${title}</h2>
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin-bottom: 20px;">
                <h3 style="color: #2c3e50; margin-top: 0;">详细信息：</h3>
                <pre style="background-color: #fff; padding: 15px; border-radius: 4px; overflow-x: auto; margin: 0;">
${JSON.stringify(data, null, 2)}
                </pre>
            </div>
            <div style="color: #7f8c8d; font-size: 12px; border-top: 1px solid #eee; padding-top: 20px;">
                此邮件由系统自动发送，请勿直接回复。
            </div>
        </div>
    `;
    
    return await sendEmail(subject, content);
}

module.exports = {
    sendEmail,
    sendAlertEmail
}; 