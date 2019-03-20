package org.snailtrail.safebox;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.DataSetObservable;
import android.database.DataSetObserver;
import android.graphics.Rect;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.provider.Settings;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.GridView;
import android.widget.LinearLayout;
import android.widget.ListAdapter;
import android.widget.TextView;

import com.google.android.material.snackbar.Snackbar;

import org.snailtrail.safebox.R;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.zip.Inflater;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class ChooseFileDialog extends AlertDialog implements ListAdapter, AdapterView.OnItemClickListener, View.OnClickListener {
    private final DataSetObservable mDataSetObservable = new DataSetObservable();

    @Override
    public boolean hasStableIds() { return false; }

    @Override
    public void registerDataSetObserver(DataSetObserver observer) { mDataSetObservable.registerObserver(observer); }

    @Override
    public void unregisterDataSetObserver(DataSetObserver observer) { mDataSetObservable.unregisterObserver(observer); }

    public void notifyDataSetChanged() { mDataSetObservable.notifyChanged(); }

    public void notifyDataSetInvalidated() { mDataSetObservable.notifyInvalidated(); }

    @Override
    public boolean areAllItemsEnabled() { return true; }

    @Override
    public boolean isEnabled(int position) { return true; }

    @Override
    public int getItemViewType(int position) { return 0; }

    @Override
    public int getViewTypeCount() { return 1; }

    @Override
    public boolean isEmpty() { return getCount() == 0; }

    @Override
    public int getCount() {
        return m_fileInfos.size();
    }

    @Override
    public Object getItem(int position) {
        return m_fileInfos.get(position);
    }

    @Override
    public long getItemId(int position) {
        return position;
    }

    @Override
    public View getView(int position, View convertView, ViewGroup parent) {
        FileInfo fileInfo = m_fileInfos.get(position);

        if (convertView == null || convertView.getTag() != fileInfo) {

            convertView = LayoutInflater.from(getContext()).inflate(R.layout.icon_list_item, parent, false);

            TextView textView = convertView.findViewById(R.id.icon_list_item_name);
            if (textView != null) {
                Rect rect = textView.getCompoundDrawables()[1].getBounds();
                textView.setText(fileInfo.m_filename);
                fileInfo.m_icon.setBounds(rect);
                textView.setCompoundDrawables(null, fileInfo.m_icon, null, null);
                textView.setSingleLine(true);
            }

            convertView.setTag(fileInfo);
        }

        return convertView;
    }

    @Override
    public void onClick(View v) {
        switch (v.getId()) {
            case R.id.choose_file_dialog_ok_button:
                if (m_type == CHOOSE_OPEN_FILE) {
                    String pathname = m_folder + "/" + m_filename;
                    File file = new File(pathname);
                    if (file.exists() && file.isFile() && file.canRead()) {
                        m_handler.obtainMessage(CHOOSE_OPEN_FILE, pathname).sendToTarget();
                        setDefaultFolder(m_folder);
                        dismiss();
                    } else {
                        Utilities.showMessageBox(m_context, R.string.error_dialog_title, R.string.choose_open_file_error);
                    }
                } else {
                    m_filename = m_filenameEdit.getText().toString();
                    String pathname = m_folder + "/" + m_filename;
                    File folder = new File(m_folder);
                    File file = new File(pathname);
                    if (!folder.canWrite()) {
                        Utilities.showMessageBox(m_context, R.string.error_dialog_title, R.string.choose_save_file_error_folder_cannot_write);
                    } else if (m_filename.equals("")) {
                        Utilities.showMessageBox(m_context, R.string.error_dialog_title, R.string.choose_save_file_error_empty_filename);
                    } else if (file.exists()) {
                        Utilities.showMessageBox(m_context, R.string.error_dialog_title, R.string.choose_save_file_error_file_exist);
                    } else {
                        try {
                            if (file.createNewFile()) {
                                //file.delete();
                                m_handler.obtainMessage(CHOOSE_SAVE_FILE, pathname).sendToTarget();
                                setDefaultFolder(m_folder);
                                dismiss();
                            }
                        } catch (IOException e) {
                            Utilities.showMessageBox(m_context, R.string.error_dialog_title, R.string.choose_save_file_error_create_file);
                            e.printStackTrace();
                        }
                    }
                }
                break;
            case R.id.choose_file_dialog_cancel_button:
                dismiss();
                break;
            default:
        }
    }

    @Override
    public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
        FileInfo fileInfo = m_fileInfos.get(position);

        if (fileInfo.m_directory) {

            String folder;

            if (fileInfo.m_filename.equals("..")) {
                if (m_folder.indexOf('/') == m_folder.lastIndexOf('/')) {
                    folder = "/";
                } else {
                    folder = m_folder.substring(0, m_folder.lastIndexOf('/'));
                }
            } else {
                folder = m_folder + "/" + fileInfo.m_filename;
            }

            File dir = new File(folder);

            if (dir.canRead()) {
                setFolder(folder);
            }

        } else {
            m_filenameEdit.setText(fileInfo.m_filename);
        }
    }

    public class FileInfo {
        String m_filename;
        Drawable m_icon;
        boolean m_directory;

        public FileInfo(String filename, Drawable icon, boolean directory) {
            m_filename = filename;
            m_icon = icon;
            m_directory = directory;
        }
    }

    private final String DEFAULT_FOLDER_KEY = "DefaultFolder";
    public static final int CHOOSE_OPEN_FILE = 1;
    public static final int CHOOSE_SAVE_FILE = 2;
    private int m_type = CHOOSE_OPEN_FILE;
    private String m_folder="";
    private String m_filename="";
    private Context m_context;
    private View m_view;
    private GridView m_gridView;
    private Button m_cancelButton;
    private Button m_okButton;
    private TextView m_titleView;
    private TextView m_folderView;
    private EditText m_filenameEdit;
    private Handler m_handler;
    ArrayList<FileInfo> m_fileInfos;
    HashMap<String, Drawable> m_iconMap;

    protected ChooseFileDialog(Context context, Handler handler, int type) {
        super(context);
        m_context = context;
        m_handler = handler;
        m_type = type;

        m_fileInfos = new ArrayList<>();

        m_iconMap = new HashMap<>();
        m_iconMap.put("folder", Utilities.getResourceIcon(m_context, "folder"));

        String[] exts = m_context.getResources().getStringArray(R.array.local_file_icon_list);
        for (String ext : exts) {
            m_iconMap.put(ext, Utilities.getResourceIcon(m_context, ext));
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LayoutInflater inflater = (LayoutInflater) getContext().getSystemService(Context.LAYOUT_INFLATER_SERVICE);
        m_view = inflater.inflate(R.layout.choose_file_dialog, null);
        setContentView(m_view);

        m_gridView = m_view.findViewById(R.id.choose_file_dialog_grid_view);
        m_gridView.setOnItemClickListener(this);
        m_gridView.setAdapter(this);

        m_cancelButton = findViewById(R.id.choose_file_dialog_cancel_button);
        if (m_cancelButton != null) { m_cancelButton.setOnClickListener(this); }

        m_okButton = findViewById(R.id.choose_file_dialog_ok_button);
        if (m_okButton != null) { m_okButton.setOnClickListener(this); }

        m_titleView = findViewById(R.id.choose_file_dialog_title);
        m_folderView = findViewById(R.id.choose_file_dialog_folder);
        m_filenameEdit = findViewById(R.id.choose_file_dialog_filename);

        if (m_type == CHOOSE_OPEN_FILE) {
            if (m_titleView != null) { m_titleView.setText(R.string.choose_file_dialog_open_title); }
            if (m_filenameEdit != null) { m_filenameEdit.setEnabled(false); }
            if (m_okButton != null) {m_okButton.setText(R.string.choose_file_dialog_open_button); }
        } else if (m_type == CHOOSE_SAVE_FILE) {
            if (m_titleView != null) { m_titleView.setText(R.string.choose_file_dialog_save_title); }
            if (m_filenameEdit != null) { m_filenameEdit.setEnabled(true); }
            if (m_okButton != null) {m_okButton.setText(R.string.choose_file_dialog_save_button); }
        } else {
            // do nothing, 4 future use
        }

        setFolder(getDefaultFolder());
    }

    protected String getDefaultFolder() {
        SharedPreferences sharedPreferences = m_context.getSharedPreferences(m_context.getPackageName(), Context.MODE_PRIVATE);
        return sharedPreferences.getString(DEFAULT_FOLDER_KEY, Environment.getExternalStorageDirectory().getAbsolutePath());
    }

    protected void setDefaultFolder(String folder) {
        SharedPreferences sharedPreferences = m_context.getSharedPreferences(m_context.getPackageName(), Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = sharedPreferences.edit();
        editor.putString(DEFAULT_FOLDER_KEY, folder);
        editor.apply();
    }

    protected void setFolder(String folder) {
        m_folder = folder;
        m_folderView.setText(m_folder);
        m_fileInfos.clear();

        if (!m_folder.equals("/")) { m_fileInfos.add(new FileInfo("..", Utilities.getResourceIcon(m_context, "folder"), true)); }

        File dir = new File(m_folder);
        File[] files = dir.listFiles();

        if (files != null && files.length > 0) {

            for (File file : files) {

                String filename = file.getName();

                if (file.isDirectory() && file.canRead()) {

                    m_fileInfos.add(new FileInfo(filename, m_iconMap.get("folder"), true));

                } else if (file.isFile()) {

                    String ext = filename.substring(filename.lastIndexOf('.') + 1);
                    Drawable drawable = m_iconMap.get(ext);

                    if (drawable == null) {
                        drawable = m_iconMap.get("other");
                    }

                    m_fileInfos.add(new FileInfo(filename, drawable, false));
                }
            }
        }

        notifyDataSetChanged();
    }
}
