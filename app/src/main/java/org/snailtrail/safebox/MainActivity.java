package org.snailtrail.safebox;

import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Message;
import android.view.Menu;
import android.view.MenuItem;

import com.google.android.material.navigation.NavigationView;

import java.lang.ref.WeakReference;
import java.security.PrivateKey;
import java.security.PublicKey;

import androidx.appcompat.app.ActionBarDrawerToggle;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.widget.Toolbar;
import androidx.core.view.GravityCompat;
import androidx.drawerlayout.widget.DrawerLayout;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

public class MainActivity extends AppCompatActivity implements NavigationView.OnNavigationItemSelectedListener {
    private static boolean m_isUserSignedIn;
    private static int m_signInUserId;
    private static String m_email;
    private static PublicKey m_publicKey;
    private static PrivateKey m_privateKey;
    SafeRecyclerAdapter m_safeRecycleAdapter;

    public class SecureHandler extends Handler {
        private WeakReference<MainActivity> m_mainActivity;
        private WeakReference<Context> m_context;

        protected SecureHandler (MainActivity activity) {
            m_mainActivity = new WeakReference<>(activity);
        }

        @Override
        public void handleMessage(Message message) {
            MainActivity mainActivity = m_mainActivity.get();

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
                        new SaveAndroidAppDialog(mainActivity, R.layout.save_android_app_dialog, this, m_publicKey, m_privateKey, (SqliteOpenHelper.ItemInfo)(message.obj)).show();
                        break;
                    case R.integer.MESSAGE_MODIFY_LOCAL_FILE_ITEM:
                        new SaveLocalFileDialog(mainActivity, R.layout.save_local_file_dialog, this, m_publicKey, m_privateKey, (SqliteOpenHelper.ItemInfo)(message.obj)).show();
                        break;
                    case R.integer.MESSAGE_MODIFY_GENERAL_ACCOUNT_ITEM:
                        new SaveGeneralAccountDialog(mainActivity, R.layout.save_general_account_dialog, this, m_publicKey, m_privateKey, (SqliteOpenHelper.ItemInfo)(message.obj)).show();
                        break;
                    default:
                        super.handleMessage(message);
                }
            } else {
                super.handleMessage(message);
            }
        }
    }

    private SecureHandler m_secureHandler = new SecureHandler (this);

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

        RecyclerView recyclerView = findViewById(R.id.safe_recycle_view);
        recyclerView.setLayoutManager(new LinearLayoutManager(this));
        m_safeRecycleAdapter = new SafeRecyclerAdapter(this, m_secureHandler, recyclerView);
        recyclerView.setAdapter(m_safeRecycleAdapter);

        m_isUserSignedIn = false;

        int nUserCount = new SqliteOpenHelper(this).getUserCount();
        if (nUserCount > 0) {
            m_secureHandler.sendEmptyMessage(R.integer.MESSAGE_DO_SIGN_IN);
        } else {
            m_secureHandler.sendEmptyMessage(R.integer.MESSAGE_DO_SIGN_UP);
        }
    }

    @Override
    public void onBackPressed() {
        DrawerLayout drawer = (DrawerLayout) findViewById(R.id.drawer_layout);
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
                    itemInfo.m_type = R.id.menu_item_add_android_app;
                    new SaveAndroidAppDialog(this, R.layout.save_android_app_dialog, m_secureHandler, m_publicKey, m_privateKey, itemInfo).show();
                    return true;

                case R.id.menu_item_add_general_account:
                    itemInfo.m_type = R.id.menu_item_add_general_account;
                    new SaveGeneralAccountDialog(this, R.layout.save_general_account_dialog, m_secureHandler, m_publicKey, m_privateKey, itemInfo).show();
                    return true;

                case R.id.menu_item_add_local_file:
                    itemInfo.m_type = R.id.menu_item_add_local_file;
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

        if (id == R.id.nav_camera) {
            // Handle the camera action
        } else if (id == R.id.nav_gallery) {

        } else if (id == R.id.nav_slideshow) {

        } else if (id == R.id.nav_manage) {

        } else if (id == R.id.nav_share) {

        } else if (id == R.id.nav_send) {

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
}
