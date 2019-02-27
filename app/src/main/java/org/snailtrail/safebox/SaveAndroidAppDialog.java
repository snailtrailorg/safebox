package org.snailtrail.safebox;

import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.view.View;
import android.widget.AutoCompleteTextView;
import android.widget.EditText;
import android.widget.ImageView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.security.PublicKey;

public class SaveAndroidAppDialog extends SaveItemDialog {

    public SaveAndroidAppDialog(Context context, int resource, Handler uiHandler, PublicKey publicKey, SqliteOpenHelper.ItemInfo itemInfo) {
        super(context, resource, uiHandler, publicKey, itemInfo);
    }

    @Override
    public void selectItemIcon(Handler handler) {
        new AndroidAppListDialog(getContext(), handler).show();
    }

    @Override
    public void setItemIconInfo(IconInfo iconInfo) {
        ((ImageView)m_view.findViewById(R.id.save_item_icon)).setImageDrawable(iconInfo.m_iconDrawable);
        ((EditText)m_view.findViewById(R.id.save_item_name)).setText(iconInfo.m_iconName);
        ((EditText)m_view.findViewById(R.id.save_item_description)).setText(iconInfo.m_iconDescription);

        m_itemInfo.m_icon = 0;
        m_itemInfo.m_appName = iconInfo.m_iconDescription;
    }

    @Override
    public void composeItemInfo() {
        EditText name = m_view.findViewById(R.id.save_item_name);
        EditText description = m_view.findViewById(R.id.save_item_description);

        m_itemInfo.m_name = (name == null) ? null : name.getText().toString();
        m_itemInfo.m_description = (description == null) ? null : description.getText().toString();

        EditText username = m_view.findViewById(R.id.save_android_app_username);
        EditText password = m_view.findViewById(R.id.save_android_app_password);
        EditText remarks = m_view.findViewById(R.id.save_android_app_remarks);
        JSONObject jsonObject = new JSONObject();

        try {
            jsonObject.put("username", (username == null) ? "" : username.getText().toString());
            jsonObject.put("password", (password == null) ? "" : password.getText().toString());
            jsonObject.put("remarks", (remarks == null) ? "" : remarks.getText().toString());
        } catch (JSONException e) {
            e.printStackTrace();
        }

        m_itemInfo.m_data = jsonObject.toString();
    }

    @Override
    public void extractItemInfo() {

    }
}