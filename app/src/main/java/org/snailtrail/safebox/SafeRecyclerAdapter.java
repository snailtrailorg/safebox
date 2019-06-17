package org.snailtrail.safebox;

import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.graphics.drawable.Drawable;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.VelocityTracker;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.core.view.ViewCompat;
import androidx.recyclerview.widget.RecyclerView;

import java.security.PublicKey;
import java.util.List;

public class SafeRecyclerAdapter extends RecyclerView.Adapter<SafeRecyclerAdapter.SafeViewHolder>  implements RecyclerView.OnItemTouchListener {

    RecyclerView m_recyclerView;
    MainActivity.SecureHandler m_uiHandler;
    Context m_context;
    PublicKey m_publicKey;
    List<SqliteOpenHelper.ItemInfo> m_itemInfos;

    SafeRecyclerAdapter(Context context, MainActivity.SecureHandler uiHandler, RecyclerView recyclerView) {
        m_context = context;
        m_uiHandler = uiHandler;
        m_recyclerView = recyclerView;
        m_recyclerView.addOnItemTouchListener(this);
        m_velocityTracker = VelocityTracker.obtain();
        m_thresholdTranslationX = 0.0f;
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
        public View m_body;
        public View m_delete;
        public View m_modify;
        public SqliteOpenHelper.ItemInfo m_itemInfo;

        public SafeViewHolder(@NonNull View itemView) {
            super(itemView);
            m_itemView = itemView;
            m_icon = itemView.findViewById(R.id.safe_list_item_icon);
            m_name = itemView.findViewById(R.id.safe_list_item_name);
            m_description = itemView.findViewById(R.id.safe_list_item_description);
            m_body = itemView.findViewById(R.id.safe_list_item_body);
            m_delete = itemView.findViewById(R.id.safe_list_item_delete);
            m_modify = itemView.findViewById(R.id.safe_list_item_modify);
        }
    }

    public void animateTranslation(final SafeViewHolder safeViewHolder, float start, float stop, float velocity) {
        final View body = safeViewHolder.m_body;
        final float begin = start;
        final float end = stop;
        long duration = Math.abs((long)((end - begin) / ((velocity == 0) ? 100 : velocity) * 1000));

        ViewCompat.postOnAnimation(m_recyclerView, new Runnable() {
            @Override
            public void run() {
                body.setTranslationX(end);
                Log.i("SafeBox", "animateTranslation, direct use setTranslationX, begin:" + begin + ", end:" + end);
            }
        });
    }

    public float getViewWidthOverall(View view) {
        ViewGroup.MarginLayoutParams layoutParams = (ViewGroup.MarginLayoutParams)view.getLayoutParams();
        return layoutParams.leftMargin + layoutParams.rightMargin + view.getWidth();
    }

    private float m_initialTouchX;
    private float m_initialTranslateX;
    private float m_lastTranslateX;
    private SafeViewHolder  m_selectedViewHolder;
    private VelocityTracker m_velocityTracker;
    private float m_thresholdTranslationX;

    @Override
    public boolean onInterceptTouchEvent(@NonNull RecyclerView rv, @NonNull MotionEvent e) {
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:

                View view = rv.findChildViewUnder(e.getX(), e.getY());
                SafeViewHolder safeViewHolder = (view == null) ? null : (SafeViewHolder) rv.findContainingViewHolder(view);

                if (safeViewHolder != null) {
                    if (m_selectedViewHolder != null && m_selectedViewHolder != safeViewHolder && m_lastTranslateX != 0.0f) {
                        animateTranslation(m_selectedViewHolder, m_lastTranslateX, 0.0f, 3000.0f);
                    }

                    if (m_selectedViewHolder != safeViewHolder) {
                        m_selectedViewHolder = safeViewHolder;
                        m_initialTranslateX = 0.0f;
                        m_lastTranslateX = m_initialTranslateX;
                    } else {
                        m_initialTranslateX = m_lastTranslateX;
                    }

                    m_thresholdTranslationX = 0.0f - (getViewWidthOverall(m_selectedViewHolder.m_delete) + getViewWidthOverall(m_selectedViewHolder.m_modify));
                    m_initialTouchX = e.getX();

                    m_velocityTracker.clear();
                    m_velocityTracker.addMovement(e);

                }

                Log.i("SafeBox", " onInterceptTouchEvent ACTION_DOWN, m_initialTranslateX:" + m_initialTranslateX + ", m_lastTranslateX:" + m_lastTranslateX + ",m_thresholdTranslationX:" + m_thresholdTranslationX);

                return false;

            case MotionEvent.ACTION_MOVE:
                if (m_selectedViewHolder != null) {
                    m_velocityTracker.addMovement(e);
                    m_velocityTracker.computeCurrentVelocity(1000);
                    float velocity = m_velocityTracker.getXVelocity();
                    float translateX = m_initialTranslateX + e.getX() - m_initialTouchX;
                    if (translateX < 0.0f) {
                        float alpha = (m_thresholdTranslationX == 0.0f) ? 0.0f : (translateX / m_thresholdTranslationX);
                        alpha = (alpha < 0.0f) ? 0.0f : ((alpha > 1.0f) ? 1.0f : alpha);
                        m_selectedViewHolder.m_delete.setAlpha(alpha);
                        m_selectedViewHolder.m_modify.setAlpha(alpha);
                    }
                    animateTranslation(m_selectedViewHolder, m_lastTranslateX, translateX, velocity);
                    m_lastTranslateX = translateX;
                    //m_selectedViewHolder.m_body.setTranslationX(m_initialTranslationX + e.getX() - m_initialTouchX);
                    Log.i("SafeBox", " onInterceptTouchEvent ACTION_MOVE, m_initialTranslateX:" + m_initialTranslateX + ", m_lastTranslateX:" + m_lastTranslateX + ",m_thresholdTranslationX:" + m_thresholdTranslationX);
                }

                return false;

            case MotionEvent.ACTION_UP:
                if (m_selectedViewHolder != null) {
                    if (m_lastTranslateX <= m_thresholdTranslationX) {
                        animateTranslation(m_selectedViewHolder, m_lastTranslateX, m_thresholdTranslationX, 3000.0f);
                        m_lastTranslateX = m_thresholdTranslationX;
                    } else {
                        animateTranslation(m_selectedViewHolder, m_lastTranslateX, 0.0f, 3000.0f);
                        m_lastTranslateX = 0.0f;
                    }
                }

                Log.i("SafeBox", " onInterceptTouchEvent ACTION_UP, m_initialTranslateX:" + m_initialTranslateX + ", m_lastTranslateX:" + m_lastTranslateX + ",m_thresholdTranslationX:" + m_thresholdTranslationX);
                return false;

            case MotionEvent.ACTION_CANCEL:
                Log.i("SafeBox", " onInterceptTouchEvent ACTION_CANCEL, m_initialTranslateX:" + m_initialTranslateX + ", m_lastTranslateX:" + m_lastTranslateX + ",m_thresholdTranslationX:" + m_thresholdTranslationX);
                return false;

            default:
                Log.i("SafeBox", " onInterceptTouchEvent " + e.getAction());
                return false;
        }
    }

    @Override
    public void onTouchEvent(@NonNull RecyclerView rv, @NonNull MotionEvent e) {
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                Log.i("SafeBox", " onTouchEvent ACTION_DOWN");
                break;
            case MotionEvent.ACTION_MOVE:
                Log.i("SafeBox", " onTouchEvent ACTION_MOVE");
                break;
            case MotionEvent.ACTION_UP:
                Log.i("SafeBox", " onTouchEvent ACTION_UP");
                break;
            case MotionEvent.ACTION_CANCEL:
                Log.i("SafeBox", " onTouchEvent ACTION_CANCEL");
                break;
            default:
                Log.i("SafeBox", " onTouchEvent " + e.getAction());
                break;
        }
    }

    @Override
    public void onRequestDisallowInterceptTouchEvent(boolean disallowIntercept) {

    }

    @Override
    public void onBindViewHolder(@NonNull final SafeViewHolder safeViewHolder, int position) {
        SqliteOpenHelper.ItemInfo itemInfo = m_itemInfos.get(position);
        Drawable drawable;

        safeViewHolder.m_itemInfo = itemInfo;

        switch (itemInfo.m_type) {
            case R.integer.ITEM_TYPE_ANDROID_APP:
                drawable = Utilities.getAndroidAppIcon(getContext(), itemInfo.m_icon);
                break;

            case R.integer.ITEM_TYPE_GENERAL_ACCOUNT:
                drawable = Utilities.getGeneralAccountIcon(getContext(), itemInfo.m_icon);
                break;

            case R.integer.ITEM_TYPE_LOCAL_FILE:
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
                final SafeViewHolder holder = (v == null) ? null : (SafeViewHolder) m_recyclerView.findContainingViewHolder(v);
                if (holder != null) {
                    switch (holder.m_itemInfo.m_type) {
                        case R.integer.ITEM_TYPE_ANDROID_APP:
                            m_uiHandler.obtainMessage(R.integer.MESSAGE_VIEW_ANDROID_APP_ITEM, holder.m_itemInfo).sendToTarget();
                            break;
                        case R.integer.ITEM_TYPE_GENERAL_ACCOUNT:
                            m_uiHandler.obtainMessage(R.integer.MESSAGE_VIEW_GENERAL_ACCOUNT_ITEM, holder.m_itemInfo).sendToTarget();
                            break;
                        case R.integer.ITEM_TYPE_LOCAL_FILE:
                            m_uiHandler.obtainMessage(R.integer.MESSAGE_VIEW_LOCAL_FILE_ITEM, holder.m_itemInfo).sendToTarget();
                            break;
                        default:
                    }
                }
            }
        });

        safeViewHolder.m_delete.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                final SafeViewHolder holder = (v == null) ? null : (SafeViewHolder) m_recyclerView.findContainingViewHolder(v);
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
                                    m_selectedViewHolder = null;
                                    m_uiHandler.sendEmptyMessage(R.integer.MESSAGE_LOAD_USER_ITEMS);
                                }
                            })
                            .setNegativeButton(R.string.delete_item_confirm_dialog_button_cancel, new DialogInterface.OnClickListener() {
                                @Override
                                public void onClick(DialogInterface dialog, int which) {

                                }
                            })
                            .create()
                            .show();
                    animateTranslation(m_selectedViewHolder, m_lastTranslateX, 0.0f, 3000.0f);
                    m_lastTranslateX = 0.0f;
                } else {
                    Utilities.jam(getContext(), R.string.delete_item_failed_cannot_find_item);
                }
            }
        });

        safeViewHolder.m_modify.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                final SafeViewHolder holder = (v == null) ? null : (SafeViewHolder) m_recyclerView.findContainingViewHolder(v);
                if (holder != null) {
                    switch (holder.m_itemInfo.m_type) {
                        case R.integer.ITEM_TYPE_ANDROID_APP:
                            m_uiHandler.obtainMessage(R.integer.MESSAGE_MODIFY_ANDROID_APP_ITEM, holder.m_itemInfo).sendToTarget();
                            break;
                        case R.integer.ITEM_TYPE_GENERAL_ACCOUNT:
                            m_uiHandler.obtainMessage(R.integer.MESSAGE_MODIFY_GENERAL_ACCOUNT_ITEM, holder.m_itemInfo).sendToTarget();
                            break;
                        case R.integer.ITEM_TYPE_LOCAL_FILE:
                            m_uiHandler.obtainMessage(R.integer.MESSAGE_MODIFY_LOCAL_FILE_ITEM, holder.m_itemInfo).sendToTarget();
                            break;
                        default:
                    }
                    animateTranslation(m_selectedViewHolder, m_lastTranslateX, 0.0f, 3000.0f);
                    m_lastTranslateX = 0.0f;
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
