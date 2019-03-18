package org.snailtrail.safebox;

import android.content.Context;
import android.graphics.drawable.Drawable;
import android.os.Handler;
import android.widget.ImageView;

import java.security.PrivateKey;
import java.security.PublicKey;

import androidx.core.content.ContextCompat;

public class SaveLocalFileDialog extends SaveItemDialog {
    public SaveLocalFileDialog(Context context, int resource, Handler uiHandler, PublicKey publicKey, PrivateKey privateKey, SqliteOpenHelper.ItemInfo itemInfo) {
        super(context, resource, uiHandler, publicKey, privateKey, itemInfo);
    }

    @Override
    public void selectItemIcon(Handler handler) {
        new LocalFileIconListDialog(getContext(), R.layout.icon_list_dialog, handler).show();

    }

    @Override
    public void setItemIconInfo(IconListDialog.IconInfo iconInfo) {
        ((ImageView)m_view.findViewById(R.id.save_item_icon)).setImageDrawable(iconInfo.m_drawable);

        m_itemInfo.m_icon = iconInfo.m_identifier;

    }

    @Override
    public Drawable getIconInfoByIdentifier(Context context, String identifier) {
        Drawable drawable =  Utilities.getResourceIcon(context, identifier);

        if (drawable != null) {
            return drawable;
        } else {
            return ContextCompat.getDrawable(context, R.drawable.local_file);
        }
    }

    @Override
    public void composeItemData() {

    }

    @Override
    public void extractItemData() {

    }
}
