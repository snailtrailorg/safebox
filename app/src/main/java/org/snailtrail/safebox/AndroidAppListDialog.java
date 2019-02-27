package org.snailtrail.safebox;

import android.app.AlertDialog;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Rect;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Message;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.GridView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

public class AndroidAppListDialog extends AlertDialog {
    public Context m_context;
    public View m_view;
    public ArrayList<AndroidAppInfo> m_androidAppInfos;
    public Handler m_handler;

    class AndroidAppInfo {
        public String m_appName;
        public String m_packageName;
        public Drawable m_icon;

        public AndroidAppInfo(String m_appName, String m_packageName, Drawable m_icon) {
            this.m_appName = m_appName;
            this.m_packageName = m_packageName;
            this.m_icon = m_icon;
        }
    }

    protected AndroidAppListDialog(Context context, Handler handler) {
        super(context);
        m_context = context;
        m_handler = handler;
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
        m_view = inflater.inflate(R.layout.android_app_list_dialog, null);
        setContentView(m_view);

        setCancelable(false);

        GridView gridView = m_view.findViewById(R.id.android_app_list_dialog_grid);

        gridView.setAdapter(new BaseAdapter() {
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

                View view = LayoutInflater.from(getContext()).inflate(R.layout.android_app_list_item, parent, false);
                TextView textView = view.findViewById(R.id.android_app_list_item_name);
                if (textView != null) {
                    Rect rect = textView.getCompoundDrawables()[1].getBounds();
                    textView.setText(androidAppInfo.m_appName);
                    androidAppInfo.m_icon.setBounds(rect);
                    textView.setCompoundDrawables(null, androidAppInfo.m_icon, null, null);
                    textView.setSingleLine(true);
                }

                return view;
            }
        });

        gridView.setOnItemClickListener(new GridView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                AndroidAppInfo androidAppInfo = m_androidAppInfos.get(position);
                SaveItemDialog.IconInfo iconInfo = new SaveItemDialog.IconInfo();
                iconInfo.m_iconDrawable = androidAppInfo.m_icon;
                iconInfo.m_iconIndex = 0;
                iconInfo.m_iconName = androidAppInfo.m_appName;
                iconInfo.m_iconDescription = androidAppInfo.m_packageName;

                Message message = new Message();
                message.what = R.id.save_item_icon;
                message.obj = iconInfo;
                m_handler.sendMessage(message);

                dismiss();
            }
        });

        Button button = m_view.findViewById(R.id.android_app_list_dialog_button_cancel);

        button.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                dismiss();
            }
        });
    }
}
