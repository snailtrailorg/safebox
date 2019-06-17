package org.snailtrail.safebox;

import android.content.Context;
import android.graphics.drawable.Drawable;

public class ViewLocalFileDialog extends ViewItemDialog {
    public ViewLocalFileDialog(Context context, int resource, SqliteOpenHelper.ItemInfo itemInfo) {
        super(context, resource, itemInfo);
    }

    @Override
    public Drawable getIconInfoByIdentifier(Context context, String identifier) {
        return null;
    }

    @Override
    public void extractItemData() {

    }
}
