import * as crypto from "crypto";

const algorithm = "aes-256-cbc";
const ENCRYPTION_KEY = Buffer.from(
  "A7D234KLXCGVNLSDF0HJ230KA345KL4A44BLPD903GB",
  "base64"
);
const IV_LENGTH = 16;

class CryptoUtil {
  encrypt(data: any) {
    let iv = crypto.randomBytes(IV_LENGTH);
    let cipher = crypto.createCipheriv(
      algorithm,
      // @ts-ignore
      Buffer.from(ENCRYPTION_KEY, "hex"),
      iv
    );
    let encrypted = cipher.update(data);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
  }

  decrypt(data: any) {
    let textParts = data.split(":");
    let iv = Buffer.from(textParts.shift(), "hex");
    let encrypted = Buffer.from(textParts.join(":"), "hex");
    let decipher = crypto.createDecipheriv(
      algorithm,
      // @ts-ignore
      Buffer.from(ENCRYPTION_KEY, "hex"),
      iv
    );
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  }
}

export default new CryptoUtil();
