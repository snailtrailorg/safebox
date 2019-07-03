package org.snailtrail.safebox;

import android.Manifest;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Message;
import android.provider.Settings;
import android.view.Menu;
import android.view.MenuItem;

import androidx.appcompat.app.ActionBarDrawerToggle;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.widget.Toolbar;
import androidx.core.app.ActivityCompat;
import androidx.core.view.GravityCompat;
import androidx.drawerlayout.widget.DrawerLayout;
import androidx.recyclerview.widget.LinearLayoutManager;

import com.google.android.material.navigation.NavigationView;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.lang.ref.WeakReference;
import java.security.PrivateKey;
import java.security.PublicKey;

public class MainActivity extends AppCompatActivity implements NavigationView.OnNavigationItemSelectedListener {
    private static boolean m_isUserSignedIn;
    private static int m_signInUserId;
    private static String m_email;
    private static PublicKey m_publicKey;
    private static PrivateKey m_privateKey;
    SafeRecyclerAdapter m_safeRecycleAdapter;

    public static class SecureHandler extends Handler {
        private WeakReference<MainActivity> m_mainActivity;
        private WeakReference<Context> m_context;

        SecureHandler(MainActivity activity, Context context) {
            m_mainActivity = new WeakReference<>(activity);
            m_context = new WeakReference<>(context);
        }

        @Override
        public void handleMessage(Message message) {
            MainActivity mainActivity = m_mainActivity.get();
            Context context = m_context.get();

            if (mainActivity != null) {
                switch (message.what) {
                    case R.integer.MESSAGE_DO_SIGN_IN:
                        mainActivity.doSignIn();
                        break;
                    case R.integer.MESSAGE_DO_SIGN_UP:
                        mainActivity.doSignUp();
                        break;
                    case R.integer.MESSAGE_SET_USER_INFO:
                        SignInDialog.SignInMessageObject obj = (SignInDialog.SignInMessageObject) message.obj;
                        assert obj != null && obj.m_email != null && obj.m_publicKey != null && obj.m_privateKey != null;
                        mainActivity.setUserInfo(obj.m_uid, obj.m_email, obj.m_publicKey, obj.m_privateKey);
                        break;
                    case R.integer.MESSAGE_LOAD_USER_ITEMS:
                        mainActivity.loadUserItems();
                        break;
                    case R.integer.MESSAGE_MODIFY_ANDROID_APP_ITEM:
                        new SaveAndroidAppDialog(context, R.layout.save_android_app_dialog, this, m_publicKey, m_privateKey, (SqliteOpenHelper.ItemInfo)(message.obj)).show();
                        break;
                    case R.integer.MESSAGE_MODIFY_LOCAL_FILE_ITEM:
                        new SaveLocalFileDialog(context, R.layout.save_local_file_dialog, this, m_publicKey, m_privateKey, (SqliteOpenHelper.ItemInfo)(message.obj)).show();
                        break;
                    case R.integer.MESSAGE_MODIFY_GENERAL_ACCOUNT_ITEM:
                        new SaveGeneralAccountDialog(context, R.layout.save_general_account_dialog, this, m_publicKey, m_privateKey, (SqliteOpenHelper.ItemInfo)(message.obj)).show();
                        break;
                    case R.integer.MESSAGE_VIEW_ANDROID_APP_ITEM:
                        new ViewAndroidAppDialog(context, R.layout.view_android_app_dialog, m_privateKey, (SqliteOpenHelper.ItemInfo)(message.obj)).show();
                        break;
                    case R.integer.MESSAGE_VIEW_LOCAL_FILE_ITEM:
                        new ViewLocalFileDialog(context, R.layout.view_local_file_dialog, m_privateKey, (SqliteOpenHelper.ItemInfo)(message.obj)).show();
                        break;
                    case R.integer.MESSAGE_VIEW_GENERAL_ACCOUNT_ITEM:
                        new ViewGeneralAccountDialog(context, R.layout.view_general_account_dialog, m_privateKey, (SqliteOpenHelper.ItemInfo)(message.obj)).show();
                        break;
                    case R.integer.MESSAGE_CHOOSE_SAVE_FILE: {
                            SqliteOpenHelper sqliteOpenHelper = new SqliteOpenHelper(context);
                            String database_content = sqliteOpenHelper.exportDatabase();

                            String fileName = (String) message.obj;

                            if (Environment.getExternalStorageState().equals(Environment.MEDIA_MOUNTED)) {
                                File file = new File(fileName);
                                FileOutputStream fileOutputStream = null;
                                try {
                                    fileOutputStream = new FileOutputStream(file);
                                } catch (FileNotFoundException e) {
                                    e.printStackTrace();
                                }
                                if (fileOutputStream != null) {
                                    try {
                                        fileOutputStream.write(database_content.getBytes());
                                        fileOutputStream.close();
                                    } catch (IOException e) {
                                        e.printStackTrace();
                                    }
                                }
                            }
                        }
                        break;
                    case R.integer.MESSAGE_CHOOSE_OPEN_FILE: {
                            ChooseFileDialog.FileInfo fileInfo = (ChooseFileDialog.FileInfo) (message.obj);
                            if (Environment.getExternalStorageState().equals(Environment.MEDIA_MOUNTED)) {
                                File file = new File(fileInfo.m_pathname);
                                int length = (int)(file.length());
                                byte[] buffer = new byte[length];
                                int count = -1;
                                FileInputStream fileInputStream = null;
                                try {
                                    fileInputStream = new FileInputStream(file);
                                } catch (FileNotFoundException e) {
                                    e.printStackTrace();
                                }
                                if (fileInputStream != null) {
                                    try {
                                        count = fileInputStream.read(buffer);
                                        fileInputStream.close();
                                    } catch (IOException e) {
                                        e.printStackTrace();
                                    }
                                }

                                if (count == length) {
                                    SqliteOpenHelper sqliteOpenHelper = new SqliteOpenHelper(context);
                                    sqliteOpenHelper.importDatabase(new String(buffer));
                                    Utilities.jam(context, R.string.restore_database_and_sign_in);
                                    this.obtainMessage(R.integer.MESSAGE_DO_SIGN_IN).sendToTarget();
                                }
                            }
                        }
                        break;
                    default:
                        super.handleMessage(message);
                }
            } else {
                super.handleMessage(message);
            }
        }
    }
    public SecureHandler m_secureHandler = new SecureHandler (this, this);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        Toolbar toolbar = (Toolbar) findViewById(R.id.toolbar);
        setSupportActionBar(toolbar);

        DrawerLayout drawer = (DrawerLayout) findViewById(R.id.drawer_layout);
        ActionBarDrawerToggle toggle = new ActionBarDrawerToggle(this, drawer, toolbar, R.string.navigation_drawer_open, R.string.navigation_drawer_close);
        drawer.addDrawerListener(toggle);
        toggle.syncState();

        NavigationView navigationView = (NavigationView) findViewById(R.id.nav_view);
        navigationView.setNavigationItemSelectedListener(this);

        SafeRecyclerView safeRecyclerView = findViewById(R.id.safe_recycle_view);
        safeRecyclerView.setLayoutManager(new LinearLayoutManager(this));
        m_safeRecycleAdapter = new SafeRecyclerAdapter(this, m_secureHandler, safeRecyclerView);
        safeRecyclerView.setAdapter(m_safeRecycleAdapter);

        m_isUserSignedIn = false;

        new Thread(new Runnable() {
            @Override
            public void run() {
                int nUserCount = new SqliteOpenHelper(MainActivity.this).getUserCount();
                if (nUserCount > 0) {
                    m_secureHandler.obtainMessage(R.integer.MESSAGE_DO_SIGN_IN).sendToTarget();
                } else {
                    m_secureHandler.obtainMessage(R.integer.MESSAGE_DO_SIGN_UP).sendToTarget();
                }
            }
        }).start();

        requestStoragePermission();
    }

    @Override
    public void onBackPressed() {
        DrawerLayout drawer = findViewById(R.id.drawer_layout);
        if (drawer.isDrawerOpen(GravityCompat.START)) {
            drawer.closeDrawer(GravityCompat.START);
        } else {
            super.onBackPressed();
        }
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        // Inflate the menu; this adds items to the action bar if it is present.
        getMenuInflater().inflate(R.menu.main, menu);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        // Handle action bar item clicks here. The action bar will
        // automatically handle clicks on the Home/Up button, so long
        // as you specify a parent activity in AndroidManifest.xml.
        int menuItemId = item.getItemId();

        if (m_isUserSignedIn) {
            SqliteOpenHelper.ItemInfo itemInfo = new SqliteOpenHelper.ItemInfo();
            itemInfo.m_uid = m_signInUserId;
            itemInfo.m_did = 0;
            itemInfo.m_icon = "";
            itemInfo.m_description = "";
            itemInfo.m_data = "";

            //noinspection SimplifiableIfStatement
            switch (menuItemId) {
                case R.id.menu_item_add_android_app:
                    itemInfo.m_type = R.integer.ITEM_TYPE_ANDROID_APP;
                    new SaveAndroidAppDialog(this, R.layout.save_android_app_dialog, m_secureHandler, m_publicKey, m_privateKey, itemInfo).show();
                    return true;

                case R.id.menu_item_add_general_account:
                    itemInfo.m_type = R.integer.ITEM_TYPE_GENERAL_ACCOUNT;
                    new SaveGeneralAccountDialog(this, R.layout.save_general_account_dialog, m_secureHandler, m_publicKey, m_privateKey, itemInfo).show();
                    return true;

                case R.id.menu_item_add_local_file:
                    itemInfo.m_type = R.integer.ITEM_TYPE_LOCAL_FILE;
                    new SaveLocalFileDialog(this, R.layout.save_local_file_dialog, m_secureHandler, m_publicKey, m_privateKey, itemInfo).show();
                    return true;

                default:
                    return super.onOptionsItemSelected(item);
            }
        }

        return false;
    }

    @SuppressWarnings("StatementWithEmptyBody")
    @Override
    public boolean onNavigationItemSelected(MenuItem item) {
        // Handle navigation view item clicks here.
        int id = item.getItemId();

        switch (id) {
            case R.id.drawer_menu_item_synchronize:
                byte[] testData = new byte[10000];
                for (int i=0; i<10000; i++) { testData[i] = 65; }
                String encryptedData = Utilities.rsaEncrypt(m_publicKey, new String(testData));
                String decryptedData = Utilities.rsaDecrypt(m_privateKey, encryptedData);
                if (decryptedData.length() == 10000) {
                    Utilities.jam(this, "rsa encrypt & decrypt test ok");
                }
                break;
            case R.id.drawer_menu_item_backup:
                new ChooseFileDialog(this, m_secureHandler, R.integer.MESSAGE_CHOOSE_SAVE_FILE, null, 0).show();
                break;
            case R.id.drawer_menu_item_restore:
                new ChooseFileDialog(this, m_secureHandler, R.integer.MESSAGE_CHOOSE_OPEN_FILE, null, 0).show();
                break;
            case R.id.drawer_menu_item_change_password:
                break;
            case R.id.drawer_menu_item_about:
                break;
            default:
        }

        DrawerLayout drawer = (DrawerLayout) findViewById(R.id.drawer_layout);
        drawer.closeDrawer(GravityCompat.START);
        return true;
    }

    private void doSignUp() {
        new SignUpDialog(this, m_secureHandler).show();
    }

    private  void doSignIn() {
        new SignInDialog(this, m_secureHandler).show();
    }

    private void setUserInfo(int uid, String email, PublicKey publicKey, PrivateKey privateKey) {
        m_signInUserId = uid;
        m_email = email;
        m_publicKey = publicKey;
        m_privateKey = privateKey;
        m_isUserSignedIn = true;
        m_secureHandler.sendEmptyMessage(R.integer.MESSAGE_LOAD_USER_ITEMS);
    }

    private void loadUserItems() {
        m_safeRecycleAdapter.loadItemInfos(m_signInUserId);
    }

    private void requestStoragePermission() {
        if (ActivityCompat.checkSelfPermission(this, android.Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            if (ActivityCompat.shouldShowRequestPermissionRationale(this, android.Manifest.permission.READ_EXTERNAL_STORAGE)) {

                new AlertDialog.Builder(this)
                    .setTitle(R.string.permission_dialog_title)
                    .setMessage(R.string.permission_dialog_message)
                    .setIcon(R.mipmap.ic_launcher)
                    .setCancelable(false)
                    .setNegativeButton(R.string.permission_dialog_cancel_button, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) { dialog.dismiss(); }
                    })
                    .setPositiveButton(R.string.permission_dialog_setting_button, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            final Intent intent = new Intent();
                            intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                            intent.addCategory(Intent.CATEGORY_DEFAULT);
                            intent.setData(Uri.parse("package:" + getPackageName()));
                            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            intent.addFlags(Intent.FLAG_ACTIVITY_NO_HISTORY);
                            intent.addFlags(Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS);
                            startActivity(intent);
                            dialog.dismiss();
                        }
                    }).create().show();
            }
        }

        ActivityCompat.requestPermissions(this, new String[] { android.Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE }, getResources().getInteger(R.integer.MESSAGE_REQUEST_PERMISSION));
    }
}
