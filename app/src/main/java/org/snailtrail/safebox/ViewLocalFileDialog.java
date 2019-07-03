package org.snailtrail.safebox;

import android.content.Context;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.os.Environment;
import android.util.Base64;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.security.PrivateKey;

import static org.snailtrail.safebox.ChooseFileDialog.TYPE_SAVE_FILE;

public class ViewLocalFileDialog extends ViewItemDialog {
    private String m_fileName;
    private String m_fileContent;
    ViewLocalFileDialog(Context context, int resource, PrivateKey privateKey, SqliteOpenHelper.ItemInfo itemInfo) {
        super(context, resource, privateKey, itemInfo);
    }

    @Override
    public Drawable getIconInfoByIdentifier(Context context, String identifier) {
        return Utilities.getLocalFileIcon(context, identifier);
    }

    @Override
    public void extractItemData(String data) {
        if (data != null && data.length() > 0) {
            EditText filename = m_view.findViewById(R.id.view_local_file_filename);

            JSONObject jsonObject = null;
            try {
                jsonObject = new JSONObject(data);
            } catch (JSONException e) {
                e.printStackTrace();
            }

            if (jsonObject != null) {
                try {
                    m_fileName = jsonObject.getString("filename");
                    m_fileContent = jsonObject.getString("content");
                    if (filename != null) { filename.setText(m_fileName);}
                } catch (JSONException e) {
                    e.printStackTrace();
                }
            }
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Button download = findViewById(R.id.view_item_download_button);

        if (download != null) {
            download.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (v.getId() == R.id.view_item_download_button) {
                        new ChooseFileDialog(getContext(), new ChooseFileDialog.Callback() {
                            @Override
                            public void doFileOperation(int type, ChooseFileDialog.FileInfo fileInfo) {
                                String fileName = fileInfo.m_pathname;

                                if (Environment.getExternalStorageState().equals(Environment.MEDIA_MOUNTED)) {
                                    File file = new File(fileName);
                                    FileOutputStream fileOutputStream = null;
                                    try {
                                        fileOutputStream = new FileOutputStream(file);
                                    } catch (FileNotFoundException e) {
                                        e.printStackTrace();
                                    }
                                    if (fileOutputStream != null && m_fileContent != null) {
                                        try {
                                            fileOutputStream.write(Base64.decode(m_fileContent, Base64.DEFAULT));
                                            fileOutputStream.close();
                                            Utilities.jam(getContext(), R.string.view_item_prompt_download_ok);
                                            dismiss();
                                        } catch (IOException e) {
                                            e.printStackTrace();
                                        }
                                    }
                                }
                            }
                        }, TYPE_SAVE_FILE, m_fileName, 0).show();
                    }
                }
            });
        }
    }
}
