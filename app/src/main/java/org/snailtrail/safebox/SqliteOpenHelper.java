package org.snailtrail.safebox;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import java.util.ArrayList;
import java.util.List;

class SqliteOpenHelper extends SQLiteOpenHelper {

    private static final String sqlite_db_name = "safebox.db";
    private static final int sqlite_db_version = 1;

    SqliteOpenHelper(Context context) {
        super(context, sqlite_db_name, null, sqlite_db_version);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        String sql_create_user_table = "create table user (uid integer primary key autoincrement, email varchar(64), shadow varchar(256), rsapubkey varchar(4096), rsaprivkey varchar(8192))";
        db.execSQL(sql_create_user_table);
        String sql_create_data_table = "create table secret (did integer primary key autoincrement, uid int, type int, name varchar(64), description varchar(128), timestamp varchar(32), data varchar(8192))";
        db.execSQL(sql_create_data_table);
        String sql_create_log_table = "create table log (lid integer primary key autoincrement, timestamp varchar(32), content varchar(256));";
        db.execSQL(sql_create_log_table);
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {

    }

    int getUserCount() {
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = db.query("user",new String[]{"email"},null, null,null,null,null);

        int result = cursor.getCount();

        cursor.close();
        db.close();

        return result;
    }

    ArrayList<String> getUserEmailList() {
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = db.query("user", new String[]{"email"},null, null, null, null, null);

        ArrayList<String> result = new ArrayList<>();

        while (cursor.moveToNext()) {
            result.add(cursor.getString(cursor.getColumnIndex("email")));
        }

        cursor.close();
        db.close();

        return result;
    }

    boolean checkEmailConfliction(String email) {
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = db.query("user",new String[]{"email"},"email=?",new String[]{email},null,null,null);

        boolean result = cursor.moveToNext();

        cursor.close();
        db.close();

        return result;
    }

    static class UserInfo {
        int m_uid;
        String m_email;
        String m_shadow;
        String m_public_key;
        String m_private_key;

        UserInfo() {}

        UserInfo(int uid, String email, String shadow, String public_key, String private_key) {
            m_uid = uid;
            m_email = email;
            m_shadow = shadow;
            m_public_key = public_key;
            m_private_key = private_key;
        }
    }

    long insertUser(UserInfo userInfo) {
        return insertUser(userInfo.m_email, userInfo.m_shadow, userInfo.m_public_key, userInfo.m_private_key);
    }

    long insertUser(String email, String shadow, String public_key, String private_key) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues values = new ContentValues();

        values.put("email", email);
        values.put("shadow",shadow);
        values.put("rsapubkey", public_key);
        values.put("rsaprivkey", private_key);

        long result = db.insert("user", null, values);

        db.close();

        return result;
    }

    UserInfo getUserInfo(String email) {
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = db.rawQuery("select * from user where email=?", new String[]{email});

        if (cursor.moveToFirst()) {
            UserInfo userInfo = new UserInfo();
            userInfo.m_uid = cursor.getInt(cursor.getColumnIndex("uid"));
            userInfo.m_email = cursor.getString(cursor.getColumnIndex("email"));
            userInfo.m_shadow = cursor.getString(cursor.getColumnIndex("shadow"));
            userInfo.m_public_key = cursor.getString(cursor.getColumnIndex("rsapubkey"));
            userInfo.m_private_key = cursor.getString(cursor.getColumnIndex("rsaprivkey"));

            cursor.close();
            db.close();
            return userInfo;
        } else {
            cursor.close();
            db.close();
            return null;
        }
    }
}
