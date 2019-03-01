package org.snailtrail.safebox;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.graphics.drawable.Drawable;
import android.view.GestureDetector;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.ItemTouchHelper;
import androidx.recyclerview.widget.RecyclerView;

public class SafeRecycleAdapter extends RecyclerView.Adapter<SafeRecycleAdapter.SafeViewHolder> {

    RecyclerView m_recyclerView;
    Context m_context;
    List<SqliteOpenHelper.ItemInfo> m_itemInfos;

    SafeRecycleAdapter(Context context, RecyclerView recyclerView) {
        m_context = context;
        m_recyclerView = recyclerView;

        new ItemTouchHelper(new ItemTouchHelper.Callback(){

            @Override
            public int getMovementFlags(@NonNull RecyclerView recyclerView, @NonNull RecyclerView.ViewHolder viewHolder) {
                 return makeMovementFlags(0, ItemTouchHelper.START | ItemTouchHelper.END);
            }

            @Override
            public boolean onMove(@NonNull RecyclerView recyclerView, @NonNull RecyclerView.ViewHolder viewHolder, @NonNull RecyclerView.ViewHolder target) {
                return false;
            }

            @Override
            public void onSwiped(@NonNull RecyclerView.ViewHolder viewHolder, int direction) {
                Utilities.jam(getContext(),"swipe");
            }
        }).attachToRecyclerView(recyclerView);
    }

    public Context getContext() { return m_context; }

    public void setContext(Context context) { m_context = context; }

    public void loadItemInfos(int uid) {
        SqliteOpenHelper sqliteOpenHelper = new SqliteOpenHelper(getContext());
        m_itemInfos = sqliteOpenHelper.getUserItemList(uid);
        notifyDataSetChanged();
    }

    public static class SafeViewHolder extends RecyclerView.ViewHolder {
        public View m_itemView;
        public ImageView m_icon;
        public TextView m_name;
        public TextView m_description;

        public SafeViewHolder(@NonNull View itemView) {
            super(itemView);
            m_itemView = itemView;
            m_icon = itemView.findViewById(R.id.safe_list_item_icon);
            m_name = itemView.findViewById(R.id.safe_list_item_name);
            m_description = itemView.findViewById(R.id.safe_list_item_description);
        }
    }

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

        if (drawable != null) { safeViewHolder.m_icon.setImageDrawable(drawable); }
        safeViewHolder.m_name.setText(m_itemInfos.get(position).m_name);
        safeViewHolder.m_description.setText(m_itemInfos.get(position).m_description);

        safeViewHolder.m_itemView.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {

            }
        });

        safeViewHolder.m_itemView.setOnTouchListener(new View.OnTouchListener() {
            @Override
            public boolean onTouch(View v, MotionEvent event) {
                return new GestureDetector(new GestureDetector.OnGestureListener() {
                    @Override
                    public boolean onDown(MotionEvent e) {
                        return false;
                    }

                    @Override
                    public void onShowPress(MotionEvent e) {

                    }

                    @Override
                    public boolean onSingleTapUp(MotionEvent e) {
                        return false;
                    }

                    @Override
                    public boolean onScroll(MotionEvent e1, MotionEvent e2, float distanceX, float distanceY) {
                        return false;
                    }

                    @Override
                    public void onLongPress(MotionEvent e) {
                        Utilities.jam(getContext(), "long press");
                    }

                    @Override
                    public boolean onFling(MotionEvent e1, MotionEvent e2, float velocityX, float velocityY) {
                        return false;
                    }
                }).onTouchEvent(event);
            }
        });
    }

    @NonNull
    @Override
    public SafeViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        return new SafeViewHolder(LayoutInflater.from(parent.getContext()).inflate(R.layout.safe_list_item, parent, false));
    }

    @Override
    public int getItemCount() { return (m_itemInfos == null) ? 0 : m_itemInfos.size(); }
}
