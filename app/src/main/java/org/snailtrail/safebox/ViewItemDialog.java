package org.snailtrail.safebox;

import android.app.AlertDialog;
import android.content.Context;
import android.graphics.drawable.Drawable;
import android.os.AsyncTask;
import android.os.Bundle;
import android.os.Handler;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.AutoCompleteTextView;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.TextView;

import java.security.KeyPair;
import java.security.PrivateKey;
import java.security.PublicKey;

public abstract class ViewItemDialog extends AlertDialog implements View.OnClickListener {
    public int m_resource;
    public View m_view;
    public PrivateKey m_privateKey;
    public SqliteOpenHelper.ItemInfo m_itemInfo;


    public ViewItemDialog(Context context, int resource, PrivateKey privateKey, SqliteOpenHelper.ItemInfo m_itemInfo) {
        super(context);
        m_resource = resource;
        m_privateKey = privateKey;
        m_itemInfo = m_itemInfo;
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

        m_view.findViewById(R.id.save_item_progress_panel).setVisibility(View.GONE);
        m_view.findViewById(R.id.save_item_form_panel).setVisibility(View.VISIBLE);

        m_view.findViewById(R.id.save_item_icon).setOnClickListener(this);
        m_view.findViewById(R.id.save_item_cancel_button).setOnClickListener(this);
        m_view.findViewById(R.id.save_item_save_button).setOnClickListener(this);
        m_view.findViewById(R.id.save_item_form_panel).setOnClickListener(this);

        ImageView icon = m_view.findViewById(R.id.save_item_icon);
        Drawable drawable = getIconInfoByIdentifier(getContext(), m_itemInfo.m_icon);
        if (drawable != null) { icon.setImageDrawable(drawable);}

        EditText name = m_view.findViewById(R.id.save_item_name);
        EditText description = m_view.findViewById(R.id.save_item_description);

        name.setText(m_itemInfo.m_name);
        description.setText(m_itemInfo.m_description);

        if (m_itemInfo.m_data != null && m_itemInfo.m_data.length() > 0) {
            m_itemInfo.m_data = Utilities.rsaDecrypt(m_privateKey, m_itemInfo.m_data);
            extractItemData();
        } else {
            m_itemInfo.m_data = "";
        }

        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
    }

    @Override
    public void dismiss() {
        m_view.findViewById(R.id.view_item_ok_button).setOnClickListener(null);

        super.dismiss();
    }

    @Override
    public void onClick(View view) {
        switch (view.getId()) {
            case R.id.view_item_ok_button:
                onClickOK(view);
                break;
            default:
                //do nothing
        }
    }

    private void onClickOK(View view) {
        dismiss();
    }
}
