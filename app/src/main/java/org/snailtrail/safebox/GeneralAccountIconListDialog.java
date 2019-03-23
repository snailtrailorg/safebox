package org.snailtrail.safebox;

import android.content.Context;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.os.Handler;

import java.util.ArrayList;

public class GeneralAccountIconListDialog extends IconListDialog {
    protected GeneralAccountIconListDialog(Context context, int resource, Handler handler) {
        super(context, resource, handler);
    }

    @Override
    protected ArrayList<IconInfo> loadIconInfos() {
        ArrayList<IconInfo> iconInfos = new ArrayList<>();
        String[] icons = m_context.getResources().getStringArray(R.array.general_account_icon_list);

        if (icons != null) {
            for (String icon : icons) {
                Drawable drawable = Utilities.getGeneralAccountIcon(m_context, icon);
                if (drawable != null) {
                    iconInfos.add(new IconInfo(drawable, icon, icon));
                }
            }
        }

        return iconInfos;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }
}
