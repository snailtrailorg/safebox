package org.snailtrail.safebox;

import android.content.Context;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.os.Handler;
import android.util.Base64;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;

import androidx.core.content.ContextCompat;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.security.PrivateKey;
import java.security.PublicKey;

import static org.snailtrail.safebox.ChooseFileDialog.TYPE_OPEN_FILE;

public class SaveLocalFileDialog extends SaveItemDialog {
    private static final int MAX_FILE_LENGTH = 262144;
    private String m_pathname = "";

    SaveLocalFileDialog(Context context, int resource, Handler uiHandler, PublicKey publicKey, PrivateKey privateKey, SqliteOpenHelper.ItemInfo itemInfo) {
        super(context, resource, uiHandler, publicKey, privateKey, itemInfo);
    }

    private void chooseOpenFile() {
        new ChooseFileDialog(getContext(), new ChooseFileDialog.Callback() {
            @Override
            public void doFileOperation(int type, ChooseFileDialog.FileInfo fileInfo) {
                setItemIconInfo(new IconListDialog.IconInfo(fileInfo.m_icon, fileInfo.m_type, fileInfo.m_type));
                EditText filename = m_view.findViewById(R.id.save_local_file_filename);
                filename.setText(fileInfo.m_filename);
                m_pathname = fileInfo.m_pathname;
            }
        }, TYPE_OPEN_FILE, null, MAX_FILE_LENGTH).show();
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
            chooseOpenFile();
        } else {
            super.onClick(view);
        }
    }

    @Override
    public void initializeItem() {
        chooseOpenFile();
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
        Drawable drawable =  Utilities.getLocalFileIcon(context, identifier);

        if (drawable != null) {
            return drawable;
        } else {
            return ContextCompat.getDrawable(context, R.drawable.local_file);
        }
    }

    @Override
    public void composeItemData() {
        byte[] buff=new byte[MAX_FILE_LENGTH];
        int hasRead=0;

        try {
            FileInputStream fileInputStream = new FileInputStream(new File(this.m_pathname));
            do { hasRead = fileInputStream.read(buff, hasRead, MAX_FILE_LENGTH - hasRead); } while (hasRead > 0);
            fileInputStream.close();
        } catch (FileNotFoundException e) {
            e.printStackTrace();
        } catch (IOException e) {
            e.printStackTrace();
        }

        EditText filename = m_view.findViewById(R.id.save_local_file_filename);

        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("filename",filename.getText().toString());
            jsonObject.put("content",Base64.encodeToString(buff,0, hasRead, Base64.DEFAULT));
        } catch (JSONException e) {
            e.printStackTrace();
        }

        m_itemInfo.m_data = jsonObject.toString();
    }

    @Override
    public void extractItemData(String data) {
        if (data != null && data.length() > 0) {
            EditText filename = m_view.findViewById(R.id.save_local_file_filename);

            JSONObject jsonObject = null;
            try {
                jsonObject = new JSONObject(data);
            } catch (JSONException e) {
                e.printStackTrace();
            }

            if (jsonObject != null) {
                try {
                    filename.setText(jsonObject.getString("filename"));
                } catch (JSONException e) {
                    e.printStackTrace();
                }
            }
        }
    }
}
