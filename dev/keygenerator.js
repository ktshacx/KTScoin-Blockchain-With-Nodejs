const EC = require('elliptic').ec;
const ec = new EC('secp256k1');

function genKey() {
const key = ec.genKeyPair();
const publicKey = key.getPublic('hex');
const privateKey = key.getPrivate('hex');

return privateKey;
}

module.exports = genKey;