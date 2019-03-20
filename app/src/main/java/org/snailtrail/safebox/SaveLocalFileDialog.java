package org.snailtrail.safebox;

import android.content.Context;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.view.View;
import android.widget.Button;
import android.widget.ImageView;

import java.security.PrivateKey;
import java.security.PublicKey;

import androidx.core.content.ContextCompat;

public class SaveLocalFileDialog extends SaveItemDialog {

    private Handler m_fileHandler = new Handler(Looper.getMainLooper()) {
        @Override
        public void handleMessage(Message msg) {
            if (msg.what == R.id.save_local_file_browse_button) {

            } else {
                super.handleMessage(msg);
            }
        }
    };

    public SaveLocalFileDialog(Context context, int resource, Handler uiHandler, PublicKey publicKey, PrivateKey privateKey, SqliteOpenHelper.ItemInfo itemInfo) {
        super(context, resource, uiHandler, publicKey, privateKey, itemInfo);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Button browse = findViewById(R.id.save_local_file_browse_button);
        if (browse != null) {
            browse.setOnClickListener(this);
        }
    }

    @Override
    public void onClick(View view) {
        if (view.getId() == R.id.save_local_file_browse_button) {
            new ChooseFileDialog(getContext(), m_fileHandler, ChooseFileDialog.CHOOSE_SAVE_FILE).show();
        } else {
            super.onClick(view);
        }
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
