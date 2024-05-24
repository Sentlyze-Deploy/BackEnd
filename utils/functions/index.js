const crypto = require('crypto');

// Add this function to generate CSRF tokens
const generateCsrfToken = () => {
    return crypto.randomBytes(64).toString('hex');
}

const sanitizeEmail = (email) => {
    return email.replace(/\./g, '').replace(/(\+.*)/, '').toLowerCase();
}

const generateRandomString = (length) => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let randomString = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        randomString += characters.charAt(randomIndex);
    }
    randomString += new Date().getTime().toString();
    return randomString;
}



module.exports = {
    sanitizeEmail,
    generateRandomString,
    createUserInfo,
    generateCsrfToken,
}