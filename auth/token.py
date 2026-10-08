import base64
import json
import time
import logging

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from config import SHARED_SECRET

def extract_token(token) -> dict:

    key = base64.b64decode(SHARED_SECRET)

    # Java generated unpadded Base64URL.
    padding = "=" * (-len(token) % 4)
    raw = base64.urlsafe_b64decode(token + padding)

    # Format:
    #   1 byte version
    #   12 bytes nonce
    #   ciphertext + 16-byte GCM tag

    if len(raw) < 1 + 12 + 16:
        raise ValueError("Invalid token")

    version = raw[0]

    if version != 1:
        raise ValueError("Unsupported token version")

    nonce = raw[1:13]
    ciphertext_and_tag = raw[13:]

    aesgcm = AESGCM(key)

    try:
        plaintext = aesgcm.decrypt(
            nonce,
            ciphertext_and_tag,
            None
        )
    except Exception:
        # Wrong key, modified token, invalid authentication tag, etc.
        raise ValueError("Invalid token")

    claims = json.loads(plaintext)

    now = int(time.time())

    if now > claims["expired"]:
        raise ValueError("Token has expired")

    return claims

def check_user(token_user, lajiauth_user):

    if token_user != lajiauth_user:
        logging.warning(f"Token user {token_user} does not match laji auth user {lajiauth_user}")
        raise PermissionError("Token belongs to a different user")
    return