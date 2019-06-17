package org.snailtrail.safebox;

import android.content.Context;
import android.graphics.drawable.Drawable;
import android.widget.EditText;

import org.json.JSONException;
import org.json.JSONObject;

public class ViewAndroidAppDialog extends ViewItemDialog {
    public ViewAndroidAppDialog(Context context, int resource, SqliteOpenHelper.ItemInfo itemInfo) {
        super(context, resource, itemInfo);
    }

    @Override
    public Drawable getIconInfoByIdentifier(Context context, String identifier) {
        return Utilities.getAndroidAppIcon(context, identifier);
    }

    @Override
    public void extractItemData() {
        if (m_itemInfo.m_data != null && m_itemInfo.m_data.length() > 0) {
            EditText username = m_view.findViewById(R.id.view_android_app_username);
            EditText password = m_view.findViewById(R.id.view_android_app_password);
            EditText remarks = m_view.findViewById(R.id.view_android_app_remarks);

            JSONObject jsonObject = null;
            try {
                jsonObject = new JSONObject(m_itemInfo.m_data);
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
