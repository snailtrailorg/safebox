package org.snailtrail.safebox;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.SQLException;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.util.Log;

import java.security.PublicKey;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Iterator;
import java.util.List;
import java.util.ListIterator;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

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
        String sql_create_item_table = "create table item (did integer primary key autoincrement, uid int, type int, icon int, appname varchar(256), name varchar(64), description varchar(128), data varchar(4096), time timestamp)";
        db.execSQL(sql_create_item_table);
        String sql_create_log_table = "create table log (lid integer primary key autoincrement, content varchar(256), time timestamp);";
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

    long removeUser(int uid) {
        SQLiteDatabase db = getWritableDatabase();

        return db.delete("user", "uid=?", new String[]{new Integer(uid).toString()});
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

    static class ItemInfo {
        int m_did;
        int m_uid;
        int m_type;
        int m_icon;
        String m_appName;
        String m_name;
        String m_description;
        String m_data;

        public ItemInfo() {}

        public ItemInfo(int did, int uid, int type, int icon, String appName, String name, String description, String data) {
            this.m_did = did;
            this.m_uid = uid;
            this.m_type = type;
            this.m_icon = icon;
            this.m_appName = appName;
            this.m_name = name;
            this.m_description = description;
            this.m_data = data;
        }
    }

    long saveItem(ItemInfo itemInfo) {
        return saveItem(itemInfo.m_did, itemInfo.m_uid, itemInfo.m_type, itemInfo.m_icon, itemInfo.m_appName, itemInfo.m_name, itemInfo.m_description, itemInfo.m_data);
    }

    long saveItem(int did, int uid, int type, int icon, String appName, String name, String description, String data) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues values = new ContentValues();

        values.put("uid", uid);
        values.put("type",type);
        values.put("icon", icon);
        values.put("appname", appName);
        values.put("name", name);
        values.put("description", description);
        values.put("data", data);

        long result = -1;

        if (did == 0) {
            //result = db.insert("item", null, values);
            try
            {
                result = db.insertOrThrow("item", null, values);
            }
            catch(SQLException e)
            {
                // Sep 12, 2013 6:50:17 AM
                Log.e("Exception","SQLException"+String.valueOf(e.getMessage()));
                e.printStackTrace();
            }

        } else {
            result = db.update("item", values, "did=?", new String[]{new Integer(did).toString()});
        }

        db.close();

        return result;
    }

    ItemInfo getItemInfo(int did) {
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = db.rawQuery("select * from item where did=?", new String[]{new Integer(did).toString()});

        if (cursor.moveToFirst()) {
            ItemInfo itemInfo = new ItemInfo();
            itemInfo.m_did = cursor.getInt(cursor.getColumnIndex("did"));
            itemInfo.m_uid = cursor.getInt(cursor.getColumnIndex("uid"));
            itemInfo.m_type = cursor.getInt(cursor.getColumnIndex("type"));
            itemInfo.m_icon = cursor.getInt(cursor.getColumnIndex("icon"));
            itemInfo.m_appName = cursor.getString(cursor.getColumnIndex("appname"));
            itemInfo.m_name = cursor.getString(cursor.getColumnIndex("name"));
            itemInfo.m_description = cursor.getString(cursor.getColumnIndex("description"));
            itemInfo.m_data = cursor.getString(cursor.getColumnIndex("data"));

            cursor.close();
            db.close();
            return itemInfo;
        } else {
            cursor.close();
            db.close();
            return null;
        }
    }

    List<ItemInfo> getUserItemList(int uid) {
        ArrayList<ItemInfo> itemInfos = new ArrayList<>();


        SQLiteDatabase db = getWritableDatabase();

        Cursor cursor = db.rawQuery("select * from item where uid=?", new String[]{new Integer(uid).toString()});

        while (cursor.moveToNext()) {
            ItemInfo itemInfo = new ItemInfo();

            itemInfo.m_did = cursor.getInt(cursor.getColumnIndex("did"));
            itemInfo.m_uid = cursor.getInt(cursor.getColumnIndex("uid"));
            itemInfo.m_type = cursor.getInt(cursor.getColumnIndex("type"));
            itemInfo.m_icon = cursor.getInt(cursor.getColumnIndex("icon"));
            itemInfo.m_appName = cursor.getString(cursor.getColumnIndex("appname"));
            itemInfo.m_name = cursor.getString(cursor.getColumnIndex("name"));
            itemInfo.m_description = cursor.getString(cursor.getColumnIndex("description"));
            itemInfo.m_data = cursor.getString(cursor.getColumnIndex("data"));

            itemInfos.add(itemInfo);
        }

        cursor.close();
        db.close();

        return itemInfos;
    }

    long removeItem(int did) {
        SQLiteDatabase db = getWritableDatabase();

        return db.delete("item", "did=?", new String[]{new Integer(did).toString()});
    }
}
