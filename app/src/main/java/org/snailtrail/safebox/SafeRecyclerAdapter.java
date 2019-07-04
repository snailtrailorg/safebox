package org.snailtrail.safebox;

import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.graphics.drawable.Drawable;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import java.util.List;

import static org.snailtrail.safebox.MainActivity.ITEM_TYPE_ANDROID_APP;
import static org.snailtrail.safebox.MainActivity.ITEM_TYPE_GENERAL_ACCOUNT;
import static org.snailtrail.safebox.MainActivity.ITEM_TYPE_LOCAL_FILE;
import static org.snailtrail.safebox.MainActivity.MESSAGE_LOAD_USER_ITEMS;
import static org.snailtrail.safebox.MainActivity.MESSAGE_MODIFY_ANDROID_APP_ITEM;
import static org.snailtrail.safebox.MainActivity.MESSAGE_MODIFY_GENERAL_ACCOUNT_ITEM;
import static org.snailtrail.safebox.MainActivity.MESSAGE_MODIFY_LOCAL_FILE_ITEM;
import static org.snailtrail.safebox.MainActivity.MESSAGE_VIEW_ANDROID_APP_ITEM;
import static org.snailtrail.safebox.MainActivity.MESSAGE_VIEW_GENERAL_ACCOUNT_ITEM;
import static org.snailtrail.safebox.MainActivity.MESSAGE_VIEW_LOCAL_FILE_ITEM;

public class SafeRecyclerAdapter extends RecyclerView.Adapter<SafeRecyclerAdapter.SafeViewHolder> {

    private SafeRecyclerView m_safeRecyclerView;
    private MainActivity.SecureHandler m_uiHandler;
    private Context m_context;
    private List<SqliteOpenHelper.ItemInfo> m_itemInfos;

    SafeRecyclerAdapter(Context context, MainActivity.SecureHandler uiHandler, SafeRecyclerView safeRecyclerView) {
        m_context = context;
        m_uiHandler = uiHandler;
        m_safeRecyclerView = safeRecyclerView;
    }

    public Context getContext() { return m_context; }

    public void setContext(Context context) { m_context = context; }

    void loadItemInfos(int uid) {
        SqliteOpenHelper sqliteOpenHelper = new SqliteOpenHelper(getContext());
        m_itemInfos = sqliteOpenHelper.getUserItemList(uid);
        notifyDataSetChanged();
    }

    static class SafeViewHolder extends RecyclerView.ViewHolder {
        View m_itemView;
        ImageView m_icon;
        TextView m_name;
        TextView m_description;
        View m_body;
        View m_delete;
        View m_modify;
        SqliteOpenHelper.ItemInfo m_itemInfo;

        SafeViewHolder(@NonNull View itemView) {
            super(itemView);
            m_itemView = itemView;
            m_itemView.setTag(this);
            m_icon = itemView.findViewById(R.id.safe_list_item_icon);
            m_name = itemView.findViewById(R.id.safe_list_item_name);
            m_description = itemView.findViewById(R.id.safe_list_item_description);
            m_body = itemView.findViewById(R.id.safe_list_item_body);
            m_delete = itemView.findViewById(R.id.safe_list_item_delete);
            m_modify = itemView.findViewById(R.id.safe_list_item_modify);
        }
    }

    @Override
    public void onBindViewHolder(@NonNull final SafeViewHolder safeViewHolder, int position) {
        SqliteOpenHelper.ItemInfo itemInfo = m_itemInfos.get(position);
        Drawable drawable;

        safeViewHolder.m_itemInfo = itemInfo;

        switch (itemInfo.m_type) {
            case ITEM_TYPE_ANDROID_APP:
                drawable = Utilities.getAndroidAppIcon(getContext(), itemInfo.m_icon);
                break;

            case ITEM_TYPE_GENERAL_ACCOUNT:
                drawable = Utilities.getGeneralAccountIcon(getContext(), itemInfo.m_icon);
                break;

            case ITEM_TYPE_LOCAL_FILE:
                drawable = Utilities.getLocalFileIcon(getContext(), itemInfo.m_icon);
                break;

            default:
                drawable = null;
                break;
        }

        if (drawable != null) { safeViewHolder.m_icon.setImageDrawable(drawable); }

        safeViewHolder.m_name.setText(m_itemInfos.get(position).m_name);
        safeViewHolder.m_description.setText(m_itemInfos.get(position).m_description);

        safeViewHolder.m_body.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                final SafeViewHolder holder = (v == null) ? null : (SafeViewHolder) m_safeRecyclerView.findContainingViewHolder(v);
                if (holder != null) {
                    switch (holder.m_itemInfo.m_type) {
                        case ITEM_TYPE_ANDROID_APP:
                            m_uiHandler.obtainMessage(MESSAGE_VIEW_ANDROID_APP_ITEM, holder.m_itemInfo).sendToTarget();
                            break;
                        case ITEM_TYPE_GENERAL_ACCOUNT:
                            m_uiHandler.obtainMessage(MESSAGE_VIEW_GENERAL_ACCOUNT_ITEM, holder.m_itemInfo).sendToTarget();
                            break;
                        case ITEM_TYPE_LOCAL_FILE:
                            m_uiHandler.obtainMessage(MESSAGE_VIEW_LOCAL_FILE_ITEM, holder.m_itemInfo).sendToTarget();
                            break;
                        default:
                    }
                    m_safeRecyclerView.resetItemTranslation();
                }
            }
        });

        safeViewHolder.m_delete.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                final SafeViewHolder holder = (v == null) ? null : (SafeViewHolder) m_safeRecyclerView.findContainingViewHolder(v);
                if (holder != null) {
                    new AlertDialog.Builder(getContext())
                            .setTitle(R.string.delete_item_confirm_dialog_title)
                            .setMessage(holder.m_itemInfo.m_name + "\n" + holder.m_itemInfo.m_description)
                            .setCancelable(false)
                            .setPositiveButton(R.string.delete_item_confirm_dialog_button_ok, new DialogInterface.OnClickListener() {
                                @Override
                                public void onClick(DialogInterface dialog, int which) {
                                    SqliteOpenHelper sqliteOpenHelper = new SqliteOpenHelper(getContext());
                                    sqliteOpenHelper.removeItem(holder.m_itemInfo.m_did);
                                    m_uiHandler.sendEmptyMessage(MESSAGE_LOAD_USER_ITEMS);
                                }
                            })
                            .setNegativeButton(R.string.delete_item_confirm_dialog_button_cancel, new DialogInterface.OnClickListener() {
                                @Override
                                public void onClick(DialogInterface dialog, int which) {

                                }
                            })
                            .create()
                            .show();
                    m_safeRecyclerView.resetItemTranslation();
                } else {
                    Utilities.jam(getContext(), R.string.delete_item_failed_cannot_find_item);
                }
            }
        });

        safeViewHolder.m_modify.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                final SafeViewHolder holder = (v == null) ? null : (SafeViewHolder) m_safeRecyclerView.findContainingViewHolder(v);
                if (holder != null) {
                    switch (holder.m_itemInfo.m_type) {
                        case ITEM_TYPE_ANDROID_APP:
                            m_uiHandler.obtainMessage(MESSAGE_MODIFY_ANDROID_APP_ITEM, holder.m_itemInfo).sendToTarget();
                            break;
                        case ITEM_TYPE_GENERAL_ACCOUNT:
                            m_uiHandler.obtainMessage(MESSAGE_MODIFY_GENERAL_ACCOUNT_ITEM, holder.m_itemInfo).sendToTarget();
                            break;
                        case ITEM_TYPE_LOCAL_FILE:
                            m_uiHandler.obtainMessage(MESSAGE_MODIFY_LOCAL_FILE_ITEM, holder.m_itemInfo).sendToTarget();
                            break;
                        default:
                    }
                    m_safeRecyclerView.resetItemTranslation();
                } else {
                    Utilities.jam(getContext(), R.string.modify_item_failed_cannot_find_item);
                }
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
