package org.snailtrail.safebox;

import android.app.AlertDialog;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Rect;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.BaseAdapter;
import android.widget.GridView;
import android.widget.ListView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

public class AndroidAppListDialog extends AlertDialog {
    public Context m_context;
    public GridView m_view;
    public ArrayList<AndroidAppInfo> m_androidAppInfos;
    public Rect m_rect;

    class AndroidAppInfo {
        public String m_appName;
        public String m_packageName;
        public Drawable m_icom;

        public AndroidAppInfo(String m_appName, String m_packageName, Drawable m_icom) {
            this.m_appName = m_appName;
            this.m_packageName = m_packageName;
            this.m_icom = m_icom;
        }
    }

    protected AndroidAppListDialog(Context context) {
        super(context);
        m_context = context;
        loadAndoirAppInfos();
    }

    protected AndroidAppListDialog(Context context, boolean cancelable, OnCancelListener cancelListener) {
        super(context, cancelable, cancelListener);
        m_context = context;
        loadAndoirAppInfos();
    }

    protected AndroidAppListDialog(Context context, int themeResId) {
        super(context, themeResId);
        m_context = context;
        loadAndoirAppInfos();
    }

    protected void loadAndoirAppInfos() {
        PackageManager packageManager = m_context .getPackageManager();
        List<PackageInfo> packgeInfos = packageManager.getInstalledPackages(0);
        m_androidAppInfos = new ArrayList<>();

        for(PackageInfo packgeInfo : packgeInfos) {
            if ((0 & packgeInfo.applicationInfo.flags & ApplicationInfo.FLAG_SYSTEM)  == 0) {
                String appName = packgeInfo.applicationInfo.loadLabel(packageManager).toString();
                String packageName = packgeInfo.packageName;
                Drawable drawable = packgeInfo.applicationInfo.loadIcon(packageManager);
                AndroidAppInfo androidAppInfo = new AndroidAppInfo(appName, packageName, drawable);
                m_androidAppInfos.add(androidAppInfo);
            }
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LayoutInflater inflater = (LayoutInflater) getContext().getSystemService(Context.LAYOUT_INFLATER_SERVICE);
        m_view = (GridView) inflater.inflate(R.layout.android_app_icon_dialog, null);
        setContentView(m_view);

        setCancelable(false);

        m_view.setAdapter(new BaseAdapter() {
            @Override
            public int getCount() {
                return (m_androidAppInfos == null) ? 0 : m_androidAppInfos.size();
            }

            @Override
            public Object getItem(int position) {
                return (m_androidAppInfos == null) ? 0 : m_androidAppInfos.get(position);
            }

            @Override
            public long getItemId(int position) {
                return position;
            }

            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                AndroidAppInfo androidAppInfo = m_androidAppInfos.get(position);

                View view = LayoutInflater.from(getContext()).inflate(R.layout.icon_list_item, parent, false);
                TextView textView = view.findViewById(R.id.icon_list_item_name);
                if (textView != null) {
                    Rect rect = textView.getCompoundDrawables()[1].getBounds();
                    textView.setText(androidAppInfo.m_appName);
                    androidAppInfo.m_icom.setBounds(rect);
                    textView.setCompoundDrawables(null, androidAppInfo.m_icom, null, null);
                    textView.setMaxWidth(rect.right);
                    textView.setSingleLine(true);
                }

                return view;
            }
        });

        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
    }

}
