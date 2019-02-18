package org.snailtrail.safebox;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.drawable.Drawable;
import android.view.LayoutInflater;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

public class SecretListAdapter extends RecyclerView.Adapter<SecretListAdapter.SecretViewHolder> {
    Context m_context;
    List<AppInfo> m_appInfos;

    public class Secret {
        int m_did;
        int m_type;
        int m_icon;
        String m_name;
        String m_description;
        String m_data;

        public Secret() {}

        public Secret(int m_did, int m_type, String m_name, String m_description, String m_data) {
            this.m_did = m_did;
            this.m_type = m_type;
            this.m_name = m_name;
            this.m_description = m_description;
            this.m_data = m_data;
        }
    }

    public class AppInfo {

        String m_name;
        String m_description;
        Drawable m_icon;

        public AppInfo(){}

        public AppInfo(String name, String description){
            this.m_name = name;
            this.m_description = description;
        }

        public AppInfo(String name,String description, Drawable icon){
            m_name = name;
            m_description = description;
            m_icon = icon;
        }
    }

    public static class SecretViewHolder extends RecyclerView.ViewHolder {
        public SecretListItem m_secretListItem;

        public SecretViewHolder(SecretListItem secretListItem) {
            super(secretListItem);
            m_secretListItem = secretListItem;
        }
    }

    SecretListAdapter() {}

    SecretListAdapter(Context context) {
        m_context = context;

        PackageManager packageManager = context.getPackageManager();
        List<PackageInfo> packgeInfos = packageManager.getInstalledPackages(0);
        m_appInfos = new ArrayList<AppInfo>();

        for(PackageInfo packgeInfo : packgeInfos){
            if ((packgeInfo.applicationInfo.flags & ApplicationInfo.FLAG_SYSTEM) == 0) {
                String appName = packgeInfo.applicationInfo.loadLabel(packageManager).toString();
                String packageName = packgeInfo.packageName;
                Drawable drawable = packgeInfo.applicationInfo.loadIcon(packageManager);
                AppInfo appInfo = new AppInfo(appName, packageName, drawable);
                m_appInfos.add(appInfo);
            }
        }
    }

    public Context getContext() { return m_context; }

    public void setContext(Context context) { m_context = context; }

    public List<AppInfo> getAppInfos() { return m_appInfos; }

    public void setAppInfos(List<AppInfo> appInfos) { m_appInfos = appInfos; }

    @Override
    public void onBindViewHolder(SecretViewHolder secretViewHolder, int position) {
        ((ImageView)secretViewHolder.m_secretListItem.findViewById(R.id.secret_list_item_icon)).setImageDrawable(m_appInfos.get(position).m_icon);
        ((TextView)secretViewHolder.m_secretListItem.findViewById(R.id.secret_list_item_name)).setText(m_appInfos.get(position).m_name);
        ((TextView)secretViewHolder.m_secretListItem.findViewById(R.id.secret_list_item_description)).setText(m_appInfos.get(position).m_description);
    }

    @NonNull
    @Override
    public SecretViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        SecretListItem secretListItem = (SecretListItem) LayoutInflater.from(parent.getContext()).inflate(R.layout.secret_list_item, parent, false);

        SecretViewHolder secretViewHolder = new SecretViewHolder(secretListItem);
        return secretViewHolder;
    }

    @Override
    public int getItemCount() { return m_appInfos == null ? 0 : m_appInfos.size(); }
}
