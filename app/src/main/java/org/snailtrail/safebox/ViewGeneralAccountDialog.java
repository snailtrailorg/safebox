package org.snailtrail.safebox;

import android.content.Context;
import android.graphics.drawable.Drawable;
import android.widget.EditText;

import org.json.JSONException;
import org.json.JSONObject;

import java.security.PrivateKey;

public class ViewGeneralAccountDialog extends ViewItemDialog {
    public ViewGeneralAccountDialog(Context context, int resource, PrivateKey privateKey, SqliteOpenHelper.ItemInfo itemInfo) {
        super(context, resource, privateKey, itemInfo);
    }

    @Override
    public Drawable getIconInfoByIdentifier(Context context, String identifier) {
        return Utilities.getGeneralAccountIcon(context, identifier);
    }

    @Override
    public void extractItemData() {
        if (m_itemInfo.m_data != null && m_itemInfo.m_data.length() > 0) {
            EditText website = m_view.findViewById(R.id.view_general_account_website);
            EditText username = m_view.findViewById(R.id.view_general_account_username);
            EditText password = m_view.findViewById(R.id.view_general_account_password);
            EditText remarks = m_view.findViewById(R.id.view_general_account_remarks);

            JSONObject jsonObject = null;
            try {
                jsonObject = new JSONObject(m_itemInfo.m_data);
            } catch (JSONException e) {
                e.printStackTrace();
            }

            if (jsonObject != null) {
                try {
                    website.setText(jsonObject.getString("website"));
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
