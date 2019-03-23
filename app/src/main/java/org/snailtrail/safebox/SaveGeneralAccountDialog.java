package org.snailtrail.safebox;

import android.content.Context;
import android.graphics.drawable.Drawable;
import android.os.Handler;
import android.widget.EditText;
import android.widget.ImageView;

import org.json.JSONException;
import org.json.JSONObject;

import java.security.PrivateKey;
import java.security.PublicKey;

import androidx.core.content.ContextCompat;

public class SaveGeneralAccountDialog extends SaveItemDialog {
    public SaveGeneralAccountDialog(Context context, int resource, Handler uiHandler, PublicKey publicKey, PrivateKey privateKey, SqliteOpenHelper.ItemInfo itemInfo) {
        super(context, resource, uiHandler, publicKey, privateKey, itemInfo);
    }

    @Override
    public void selectItemIcon(Handler handler) {
        new GeneralAccountIconListDialog(getContext(), R.layout.icon_list_dialog, handler).show();
    }

    @Override
    public void setItemIconInfo(IconListDialog.IconInfo iconInfo) {
        ((ImageView)m_view.findViewById(R.id.save_item_icon)).setImageDrawable(iconInfo.m_drawable);

        m_itemInfo.m_icon = iconInfo.m_identifier;
    }

    @Override
    public Drawable getIconInfoByIdentifier(Context context, String identifier) {
        Drawable drawable =  Utilities.getGeneralAccountIcon(context, identifier);

        if (drawable != null) {
            return drawable;
        } else {
            return ContextCompat.getDrawable(context, R.drawable.general_account);
        }
    }

    @Override
    public void composeItemData() {
        EditText website = m_view.findViewById(R.id.save_general_account_website);
        EditText username = m_view.findViewById(R.id.save_general_account_username);
        EditText password = m_view.findViewById(R.id.save_general_account_password);
        EditText remarks = m_view.findViewById(R.id.save_general_account_remarks);
        JSONObject jsonObject = new JSONObject();

        try {
            jsonObject.put("website", (website == null) ? "" : website.getText().toString());
            jsonObject.put("username", (username == null) ? "" : username.getText().toString());
            jsonObject.put("password", (password == null) ? "" : password.getText().toString());
            jsonObject.put("remarks", (remarks == null) ? "" : remarks.getText().toString());
        } catch (JSONException e) {
            e.printStackTrace();
        }

        m_itemInfo.m_data = jsonObject.toString();
    }

    @Override
    public void extractItemData() {
        EditText website = m_view.findViewById(R.id.save_general_account_website);
        EditText username = m_view.findViewById(R.id.save_general_account_username);
        EditText password = m_view.findViewById(R.id.save_general_account_password);
        EditText remarks = m_view.findViewById(R.id.save_general_account_remarks);

        String decryptedData = Utilities.rsaDecrypt(m_privateKey, m_itemInfo.m_data);
        JSONObject jsonObject = null;
        try {
            jsonObject = new JSONObject(decryptedData);
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
