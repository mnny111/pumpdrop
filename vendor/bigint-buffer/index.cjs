'use strict';
function toBigIntBE(bytes){const b=Buffer.from(bytes);return b.length?BigInt('0x'+b.toString('hex')):0n}
function toBigIntLE(bytes){return toBigIntBE(Buffer.from(bytes).reverse())}
function toBufferBE(number,width){const n=BigInt(number);if(!Number.isSafeInteger(width)||width<0||width>4096)throw new RangeError('Invalid integer width');if(n<0n||n>=(1n<<BigInt(width*8)))throw new RangeError('Integer does not fit buffer');if(!width)return Buffer.alloc(0);return Buffer.from(n.toString(16).padStart(width*2,'0'),'hex')}
function toBufferLE(number,width){return toBufferBE(number,width).reverse()}
module.exports={toBigIntBE,toBigIntLE,toBufferBE,toBufferLE};
