package org.snailtrail.safebox;

import android.app.AlertDialog;
import android.content.Context;
import android.org.apache.commons.codec.binary.Hex;
import android.util.Base64;
import android.widget.Toast;

import java.security.InvalidAlgorithmParameterException;
import java.security.InvalidKeyException;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.spec.InvalidKeySpecException;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;

import javax.crypto.BadPaddingException;
import javax.crypto.Cipher;
import javax.crypto.IllegalBlockSizeException;
import javax.crypto.NoSuchPaddingException;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import static android.os.SystemClock.uptimeMillis;

class Utilities {

    private final static byte[] initialVector = {'S', 'N', 'A', 'I', 'L', 'E', 'Y', 'E'};
    private final static String arbitraryPhrase = "SafeBox";
    private final static String digestAlgorithm = "SHA-256";
    private final static String symmetricEncryptAlgorithm = "DESede/CBC/PKCS5Padding";
    private final static String asymmetricEncryptAlgorithm = "RSA";
    private final static int rsaKeyLength = 4096;
    private final static int paddingLength = 8;

    static void jam(Context context, String message) {
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show();
    }

    static void jam(Context context, int message_id) {
        Toast.makeText(context, message_id, Toast.LENGTH_SHORT).show();
    }

    static void showMessageBox(Context context, int title, int message) {
        new AlertDialog.Builder(context).setTitle(title).setMessage(message).setPositiveButton(R.string.error_dialog_button_ok, null).show();
    }

    static String caculateDigist(String email, String password) {
        String message = String.format("%s:%s:%s", arbitraryPhrase, email, password);
        MessageDigest messageDigest = null;

        try {
            messageDigest = MessageDigest.getInstance(digestAlgorithm);
        } catch (NoSuchAlgorithmException e1) {
            e1.printStackTrace();
        }

        if (messageDigest == null) {
            return null;
        }

        messageDigest.update(message.getBytes());
        byte[] digest = messageDigest.digest();

        return Hex.encodeHexString(digest);
    }

    static KeyPair generateRSAKey() {
        SecureRandom secureRandom = new SecureRandom();
        secureRandom.setSeed(uptimeMillis());

        KeyPairGenerator keyPairGenerator = null;

        try {
            keyPairGenerator = KeyPairGenerator.getInstance(asymmetricEncryptAlgorithm);
        } catch (NoSuchAlgorithmException e) {
            e.printStackTrace();
        }

        if (keyPairGenerator != null) {
            keyPairGenerator.initialize(rsaKeyLength, secureRandom);
        } else {
            return null;
        }

        return keyPairGenerator.generateKeyPair();
    }

    static String encodedPublicKey(PublicKey publicKey) {
        return Base64.encodeToString(publicKey.getEncoded(), Base64.DEFAULT);
    }

    static String encodedPrivateKey(PrivateKey privateKey) {
        return Base64.encodeToString(privateKey.getEncoded(), Base64.DEFAULT);
    }

    static PublicKey decodePublicKey(String public_key) {
        byte[] base64DecodedPublicKey = Base64.decode(public_key, Base64.DEFAULT);
        X509EncodedKeySpec publicKeySpec = new X509EncodedKeySpec(base64DecodedPublicKey);

        KeyFactory keyFactory = null;
        try {
            keyFactory = KeyFactory.getInstance(asymmetricEncryptAlgorithm);
        } catch (NoSuchAlgorithmException e) {
            e.printStackTrace();
        }

        PublicKey publicKey = null;
        try {
            publicKey = keyFactory.generatePublic(publicKeySpec);
        } catch (InvalidKeySpecException e) {
            e.printStackTrace();
        }

        return publicKey;
    }

    static PrivateKey decodePrivateKey(String private_key) {
        byte[] base64DecodedPrivateKey = Base64.decode(private_key, Base64.DEFAULT);
        PKCS8EncodedKeySpec privateKeySpec = new PKCS8EncodedKeySpec(base64DecodedPrivateKey);

        KeyFactory keyFactory = null;
        try {
            keyFactory = KeyFactory.getInstance(asymmetricEncryptAlgorithm);
        } catch (NoSuchAlgorithmException e) {
            e.printStackTrace();
        }

        PrivateKey privateKey = null;
        try {
            privateKey = keyFactory.generatePrivate(privateKeySpec);
        } catch (InvalidKeySpecException e) {
            e.printStackTrace();
        }

        return privateKey;
    }

    static String tripleDesEncrypt(String message, String password) {

        SecretKeySpec secretKey = generateSecretKey(password);
        IvParameterSpec ivParameterSpec = new IvParameterSpec(initialVector);

        SecureRandom secureRandom = new SecureRandom();
        secureRandom.setSeed(uptimeMillis());

        byte[] padding_data = new byte[paddingLength];
        for (int i=0; i<paddingLength; i++) padding_data[i] = (byte)(Math.abs(secureRandom.nextInt()) % 95 + 32);

        String padding = new String(padding_data);
        String input = String.format("%s%s", padding, message);

        byte[] result = null;
        Cipher cipher = null;

        try {
            cipher = Cipher.getInstance(symmetricEncryptAlgorithm);
        } catch (NoSuchAlgorithmException e) {
            e.printStackTrace();
        } catch (NoSuchPaddingException e) {
            e.printStackTrace();
        }

        try {
            if (cipher != null) {
                cipher.init(Cipher.ENCRYPT_MODE, secretKey, ivParameterSpec);
            }
        } catch (InvalidKeyException e) {
            e.printStackTrace();
        } catch (InvalidAlgorithmParameterException e) {
            e.printStackTrace();
        }

        try {
            if (cipher != null) {
                result = cipher.doFinal(input.getBytes());
            }
        } catch (BadPaddingException e) {
            e.printStackTrace();
        } catch (IllegalBlockSizeException e) {
            e.printStackTrace();
        }

        if (result == null) {
            return null;
        } else {
            return Base64.encodeToString(result, Base64.DEFAULT);
        }
    }

    static String tripleDesDecrypt(String message, String password) {

        SecretKeySpec secretKey = generateSecretKey(password);
        IvParameterSpec ivParameterSpec = new IvParameterSpec(initialVector);

        byte[] input = Base64.decode(message,Base64.DEFAULT);
        byte[] result = null;
        Cipher cipher = null;

        try {
            cipher = Cipher.getInstance(symmetricEncryptAlgorithm);
        } catch (NoSuchAlgorithmException e) {
            e.printStackTrace();
        } catch (NoSuchPaddingException e) {
            e.printStackTrace();
        }

        try {
            if (cipher != null) {
                cipher.init(Cipher.DECRYPT_MODE, secretKey, ivParameterSpec);
            }
        } catch (InvalidKeyException e) {
            e.printStackTrace();
        } catch (Exception e) {
            e.printStackTrace();
        }

        try {
            if (cipher != null) {
                result = cipher.doFinal(input);
            }
        } catch (BadPaddingException e) {
            e.printStackTrace();
        } catch (IllegalBlockSizeException e) {
            e.printStackTrace();
        }

        if (result == null || result.length <= paddingLength) {
            return null;
        } else {
            return new String(result, paddingLength, result.length - paddingLength);
        }
    }

    private static SecretKeySpec generateSecretKey(String password) {
        String message = String.format("%s:%s", arbitraryPhrase, password);
        MessageDigest messageDigest = null;

        try {
            messageDigest = MessageDigest.getInstance(digestAlgorithm);
        } catch (NoSuchAlgorithmException e1) {
            e1.printStackTrace();
        }

        if (messageDigest == null) {
            return null;
        }

        messageDigest.update(message.getBytes());
        byte[] digest = messageDigest.digest();

        return new SecretKeySpec(digest, 8, 24, symmetricEncryptAlgorithm);
    }

    static class SignInMessageObject {
        int m_uid;
        String m_email;
        PublicKey m_publicKey;
        PrivateKey m_privateKey;

        SignInMessageObject() {}

        SignInMessageObject(int uid, String email, PublicKey publicKey, PrivateKey privateKey) {
            m_uid = uid;
            m_email = email;
            m_publicKey = publicKey;
            m_privateKey = privateKey;
        }
    }
}
