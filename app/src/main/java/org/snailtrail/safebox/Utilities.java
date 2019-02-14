package org.snailtrail.safebox;

import android.app.AlertDialog;
import android.content.Context;
import android.org.apache.commons.codec.binary.Hex;
import android.util.Base64;
import android.widget.Toast;

import java.security.InvalidAlgorithmParameterException;
import java.security.InvalidKeyException;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.SecureRandom;

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
        new AlertDialog.Builder(context).setTitle(title).setMessage(message).setPositiveButton(R.string.dialog_button_ok, null).show();
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

    static String getEncodedPublicKey(KeyPair keyPair) {
        return Base64.encodeToString(keyPair.getPublic().getEncoded(), Base64.DEFAULT);
    }

    static String getEncodedPrivateKey(KeyPair keyPair) {
        return Base64.encodeToString(keyPair.getPrivate().getEncoded(), Base64.DEFAULT);
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

    public static PublicKey getPublicKey(String encryptedPublicKey) {
        return null;
    }

    public static PrivateKey getPrivateKey(String encryptedPrivateKey) {
        return null;
    }
}
