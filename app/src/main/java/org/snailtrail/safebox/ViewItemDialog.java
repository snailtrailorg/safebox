package org.snailtrail.safebox;

import android.app.AlertDialog;
import android.content.Context;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.animation.AlphaAnimation;
import android.widget.ImageView;
import android.widget.TextView;

import java.security.PrivateKey;

import static android.view.MotionEvent.ACTION_CANCEL;
import static android.view.MotionEvent.ACTION_DOWN;
import static android.view.MotionEvent.ACTION_UP;

public abstract class ViewItemDialog extends AlertDialog implements View.OnClickListener, View.OnTouchListener {
    public int m_resource;
    public View m_view;
    public PrivateKey m_privateKey;
    public SqliteOpenHelper.ItemInfo m_itemInfo;

    public ViewItemDialog(Context context, int resource, SqliteOpenHelper.ItemInfo itemInfo) {
        super(context);
        m_resource = resource;
        m_itemInfo = itemInfo;
    }

    public abstract Drawable getIconInfoByIdentifier(Context context, String identifier);
    public abstract void extractItemData();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LayoutInflater inflater = (LayoutInflater) getContext().getSystemService(Context.LAYOUT_INFLATER_SERVICE);
        m_view = inflater.inflate(m_resource, null);
        setContentView(m_view);

        setCancelable(false);

        m_view.findViewById(R.id.view_item_cancel_button).setOnClickListener(this);
        m_view.findViewById(R.id.view_item_view_button).setOnTouchListener(this);

        ImageView icon = m_view.findViewById(R.id.view_item_icon);
        Drawable drawable = getIconInfoByIdentifier(getContext(), m_itemInfo.m_icon);
        if (drawable != null) { icon.setImageDrawable(drawable);}

        TextView name = m_view.findViewById(R.id.view_item_name);
        TextView description = m_view.findViewById(R.id.view_item_description);

        name.setText(m_itemInfo.m_name);
        description.setText(m_itemInfo.m_description);

        if (m_itemInfo.m_data != null && m_itemInfo.m_data.length() > 0) {
            m_itemInfo.m_data = Utilities.rsaDecrypt(m_privateKey, m_itemInfo.m_data);
            extractItemData();
        } else {
            m_itemInfo.m_data = "";
        }
    }

    @Override
    public void dismiss() {
        m_view.findViewById(R.id.view_item_cancel_button).setOnClickListener(null);
        m_view.findViewById(R.id.view_item_view_button).setOnTouchListener(null);

        super.dismiss();
    }

    @Override
    public void onClick(View view) {
        switch (view.getId()) {
            case R.id.view_item_cancel_button:
                dismiss();
                break;
            default:
                //do nothing
        }
    }

    @Override
    public boolean onTouch(View v, MotionEvent event) {
        if (v.getId() == R.id.view_item_view_button) {
            View mask = m_view.findViewById(R.id.view_item_mask);
            if (mask != null) {
                AlphaAnimation alphaAnimation;

                switch (event.getAction()) {
                    case ACTION_DOWN:
                        alphaAnimation = new AlphaAnimation(1.0f, 0.0f);
                        alphaAnimation.setFillAfter(true);
                        alphaAnimation.setDuration(1000);
                        mask.startAnimation(alphaAnimation);
                        break;
                    case ACTION_UP:
                    case ACTION_CANCEL:
                        alphaAnimation = new AlphaAnimation(0.0f, 1.0f);
                        alphaAnimation.setFillAfter(true);
                        alphaAnimation.setDuration(1000);
                        mask.startAnimation(alphaAnimation);
                        break;
                    default:
                        //do nothing
                }
            }
        }
        return false;
    }
}
