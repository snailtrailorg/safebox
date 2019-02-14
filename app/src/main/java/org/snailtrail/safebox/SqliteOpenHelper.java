package org.snailtrail.safebox;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import java.util.ArrayList;
import java.util.List;

public class SqliteOpenHelper extends SQLiteOpenHelper {

    private static final String sqlite_db_name = "safebox.db";
    private static final int sqlite_db_version = 1;

    public SqliteOpenHelper(Context context) {
        super(context, sqlite_db_name, null, sqlite_db_version);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        String sql_create_user_table = "create table user (uid integer primary key autoincrement, email varchar(64), shadow varchar(256), rsapubkey varchar(4096), rsaprivkey varchar(8192))";
        db.execSQL(sql_create_user_table);
        String sql_create_data_table = "create table data (did integer primary key autoincrement, uid int, item_type int, item_name varchar(64), item_desc varchar(128), timestamp varchar(32), item_data varchar(8192))";
        db.execSQL(sql_create_data_table);
        String sql_create_log_table = "create table log (lid integer primary key autoincrement, timestamp varchar(32), content varchar(256));";
        db.execSQL(sql_create_log_table);
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {

    }

    public int getUserCount() {
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = db.query("user",new String[]{"email"},null, null,null,null,null);

        int result = cursor.getCount();

        db.close();

        return result;
    }

    public ArrayList<String> getUserEmailList() {
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = db.query("user", new String[]{"email"},null, null, null, null, null);

        ArrayList<String> result = new ArrayList<String>();

        while (cursor.moveToNext()) {
            result.add(cursor.getString(cursor.getColumnIndex("email")));
        }

        db.close();

        return result;
    }

    public boolean checkEmailConfliction(String email) {
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = db.query("user",new String[]{"email"},"email=?",new String[]{email},null,null,null);

        boolean result = cursor.moveToNext();

        db.close();

        return result;
    }

    public long insertUser(String email, String shadow, String rsapubkey, String rsaprivkey) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues values = new ContentValues();

        values.put("email", email);
        values.put("shadow",shadow);
        values.put("rsapubkey", rsapubkey);
        values.put("rsaprivkey", rsaprivkey);

        long result = db.insert("user", null, values);

        db.close();

        return result;
    }
}
