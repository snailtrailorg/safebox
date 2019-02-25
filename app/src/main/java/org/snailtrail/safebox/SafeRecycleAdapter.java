package org.snailtrail.safebox;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.graphics.drawable.Drawable;
import android.view.LayoutInflater;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

public class SafeRecycleAdapter extends RecyclerView.Adapter<SafeRecycleAdapter.SafeViewHolder> {
    int m_signInUserId;
    Context m_context;
    List<SqliteOpenHelper.ItemInfo> m_itemInfos;

    public static class SafeViewHolder extends RecyclerView.ViewHolder {
        public SafeRecycleItem m_safeRecycleItem;

        public SafeViewHolder(SafeRecycleItem safeRecycleItem) {
            super(safeRecycleItem);
            m_safeRecycleItem = safeRecycleItem;
        }
    }

    SafeRecycleAdapter() {}

    SafeRecycleAdapter(Context context) {
        m_context = context;
    }

    public Context getContext() { return m_context; }

    public void setContext(Context context) { m_context = context; }

    public void loadItemInfos(int uid) {
        SqliteOpenHelper sqliteOpenHelper = new SqliteOpenHelper(getContext());
        m_itemInfos = sqliteOpenHelper.getUserItemList(uid);
        notifyDataSetChanged();
    }

    public List<SqliteOpenHelper.ItemInfo> getItemInfos() { return m_itemInfos; }

    public void setItemInfos(List<SqliteOpenHelper.ItemInfo> itemInfos) { m_itemInfos = itemInfos; }

    @Override
    public void onBindViewHolder(SafeViewHolder safeViewHolder, int position) {
        SqliteOpenHelper.ItemInfo itemInfo = m_itemInfos.get(position);
        Drawable drawable;

        switch (itemInfo.m_type) {
            case R.id.menu_item_add_android_app:
                PackageManager packageManager = getContext().getPackageManager();
                PackageInfo packageInfo = null;

                try {
                    packageInfo = packageManager.getPackageInfo(itemInfo.m_appName, 0);
                } catch (PackageManager.NameNotFoundException e) {
                    e.printStackTrace();
                }

                if (packageInfo != null) {
                    drawable = packageInfo.applicationInfo.loadIcon(packageManager);
                } else {
                    drawable = getContext().getDrawable(R.drawable.android_app);
                }
                break;

            case R.id.menu_item_add_general_account:
                drawable = getContext().getDrawable(R.drawable.general_account);
                break;

            case R.id.menu_item_add_local_file:
                drawable = getContext().getDrawable(R.drawable.local_file);
                break;

            default:
                drawable = null;
                break;
        }

        if (drawable != null) ((ImageView)safeViewHolder.m_safeRecycleItem.findViewById(R.id.safe_list_item_icon)).setImageDrawable(drawable);
        ((TextView)safeViewHolder.m_safeRecycleItem.findViewById(R.id.safe_list_item_name)).setText(m_itemInfos.get(position).m_name);
        ((TextView)safeViewHolder.m_safeRecycleItem.findViewById(R.id.safe_list_item_description)).setText(m_itemInfos.get(position).m_description);
    }

    @NonNull
    @Override
    public SafeViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        SafeRecycleItem SafeListItem = (SafeRecycleItem) LayoutInflater.from(parent.getContext()).inflate(R.layout.safe_list_item, parent, false);

        SafeViewHolder SafeViewHolder = new SafeViewHolder(SafeListItem);
        return SafeViewHolder;
    }

    @Override
    public int getItemCount() { return (m_itemInfos == null) ? 0 : m_itemInfos.size(); }
}
