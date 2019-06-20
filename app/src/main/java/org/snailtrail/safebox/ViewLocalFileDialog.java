package org.snailtrail.safebox;

import android.content.Context;
import android.graphics.drawable.Drawable;

import java.security.PrivateKey;

public class ViewLocalFileDialog extends ViewItemDialog {
    public ViewLocalFileDialog(Context context, int resource, PrivateKey privateKey, SqliteOpenHelper.ItemInfo itemInfo) {
        super(context, resource, privateKey, itemInfo);
    }

    @Override
    public Drawable getIconInfoByIdentifier(Context context, String identifier) {
        return null;
    }

    @Override
    public void extractItemData() {

    }
}
