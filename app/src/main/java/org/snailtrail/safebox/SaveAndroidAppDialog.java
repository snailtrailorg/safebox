package org.snailtrail.safebox;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.os.Handler;
import android.view.View;
import android.widget.AutoCompleteTextView;
import android.widget.EditText;
import android.widget.ImageView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.security.PrivateKey;
import java.security.PublicKey;

public class SaveAndroidAppDialog extends SaveItemDialog {

    public SaveAndroidAppDialog(Context context, int resource, Handler uiHandler, PublicKey publicKey, PrivateKey privateKey, SqliteOpenHelper.ItemInfo itemInfo) {
        super(context, resource, uiHandler, publicKey, privateKey, itemInfo);
    }

    @Override
    public void initializeItem() {
        selectItemIcon(m_iconHandler);
    }

    @Override
    public void selectItemIcon(Handler handler) {
        new AndroidAppIconListDialog(getContext(), R.layout.icon_list_dialog, handler).show();
    }

    @Override
    public void setItemIconInfo(IconListDialog.IconInfo iconInfo) {
        ((ImageView)m_view.findViewById(R.id.save_item_icon)).setImageDrawable(iconInfo.m_drawable);
        ((EditText)m_view.findViewById(R.id.save_item_name)).setText(iconInfo.m_name);
        ((EditText)m_view.findViewById(R.id.save_item_description)).setText(iconInfo.m_identifier);

        m_itemInfo.m_icon = iconInfo.m_identifier;
    }

    @Override
    public Drawable getIconInfoByIdentifier(Context context, String identifier) {
        return Utilities.getAndroidAppIcon(context, identifier);
    }

    @Override
    public void composeItemData() {
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
    public void extractItemData(String data) {
        if (data != null && data.length() > 0) {
            EditText username = m_view.findViewById(R.id.save_android_app_username);
            EditText password = m_view.findViewById(R.id.save_android_app_password);
            EditText remarks = m_view.findViewById(R.id.save_android_app_remarks);

            JSONObject jsonObject = null;
            try {
                jsonObject = new JSONObject(data);
            } catch (JSONException e) {
                e.printStackTrace();
            }

            if (jsonObject != null) {
                try {
                    username.setText(jsonObject.getString("username"));
                    password.setText(jsonObject.getString("password"));
                    remarks.setText(jsonObject.getString("remarks"));
                } catch (JSONException e) {
                    e.printStackTrace();
                }
            }
        }
    }
}