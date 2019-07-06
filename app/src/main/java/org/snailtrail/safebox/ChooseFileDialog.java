package org.snailtrail.safebox;

import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.SharedPreferences;
import android.database.DataSetObservable;
import android.database.DataSetObserver;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.os.Environment;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.AdapterView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.ListAdapter;
import android.widget.TextView;

import androidx.core.content.ContextCompat;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;

public class ChooseFileDialog extends AlertDialog implements ListAdapter, AdapterView.OnItemClickListener, View.OnClickListener {
    private final DataSetObservable mDataSetObservable = new DataSetObservable();

    @Override
    public boolean hasStableIds() { return false; }

    @Override
    public void registerDataSetObserver(DataSetObserver observer) { mDataSetObservable.registerObserver(observer); }

    @Override
    public void unregisterDataSetObserver(DataSetObserver observer) { mDataSetObservable.unregisterObserver(observer); }

    private void notifyDataSetChanged() { mDataSetObservable.notifyChanged(); }

    private void notifyDataSetInvalidated() { mDataSetObservable.notifyInvalidated(); }

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

            ImageView imageView = convertView.findViewById(R.id.icon_list_item_icon);
            TextView textView = convertView.findViewById(R.id.icon_list_item_name);
            if (imageView != null) { imageView.setImageDrawable(fileInfo.m_icon); }
            if (textView != null) { textView.setText(fileInfo.m_filename); }

            convertView.setTag(fileInfo);
        }

        return convertView;
    }

    private void doSaveFileCallback(FileInfo fileInfo) {
        m_callback.doFileOperation(m_type, m_fileInfos.get(m_selected));
        setDefaultFolder(m_folder);
        dismiss();
    }

    @Override
    public void onClick(View v) {
        switch (v.getId()) {
            case R.id.choose_file_dialog_ok_button:
                if (m_type == TYPE_OPEN_FILE) {
                    FileInfo fileInfo = m_fileInfos.get(m_selected);
                    File file = new File(fileInfo.m_pathname);
                    if (m_max_open_file_length > 0 && file.length() > m_max_open_file_length) {
                        Utilities.showMessageBox(m_context, m_context.getString(R.string.error_dialog_title), String.format(getContext().getString(R.string.choose_save_file_error_file_too_large), m_max_open_file_length));
                    }else  if (file.exists() && file.isFile() && file.canRead()) {
                        m_callback.doFileOperation(m_type, m_fileInfos.get(m_selected));
                        setDefaultFolder(m_folder);
                        dismiss();
                    }
                    else {
                        Utilities.showMessageBox(m_context, R.string.error_dialog_title, R.string.choose_open_file_error);
                    }
                } else {
                    m_filename = m_filenameEdit.getText().toString();
                    String pathname = m_folder + "/" + m_filename;
                    File folder = new File(m_folder);
                    File file = new File(pathname);
                    final FileInfo fileInfo = new FileInfo(pathname, null, null, null, false);

                    if (!folder.canWrite()) {
                        Utilities.showMessageBox(m_context, R.string.error_dialog_title, R.string.choose_save_file_error_folder_cannot_write);
                    } else if (m_filename.equals("")) {
                        Utilities.showMessageBox(m_context, R.string.error_dialog_title, R.string.choose_save_file_error_empty_filename);
                    } else if (file.exists()) {
                        new AlertDialog.Builder(m_context)
                                .setTitle(R.string.error_dialog_title)
                                .setMessage(R.string.choose_save_file_error_file_exist)
                                .setCancelable(false)
                                .setPositiveButton(R.string.error_dialog_button_ok, new DialogInterface.OnClickListener() {
                                    @Override
                                    public void onClick(DialogInterface dialog, int which) {
                                        dialog.dismiss();
                                        doSaveFileCallback(fileInfo);
                                    }
                                })
                                .setNegativeButton(R.string.error_dialog_button_cancel, new DialogInterface.OnClickListener() {
                                    @Override
                                    public void onClick(DialogInterface dialog, int which) {
                                        dialog.dismiss();
                                    }
                                })
                                .create().show();
                    } else {
                        doSaveFileCallback(fileInfo);
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

        if (fileInfo.m_dir) {

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
            m_filename = fileInfo.m_filename;
            m_filenameEdit.setText(m_filename);
            m_selected = position;
        }
    }

    class FileInfo {
        String m_pathname;
        String m_filename;
        String m_type;
        Drawable m_icon;
        boolean m_dir;

        FileInfo(String pathname, String filename, String type, Drawable icon, boolean dir) {
            m_pathname = pathname;
            m_filename = filename;
            m_type = type;
            m_icon = icon;
            m_dir = dir;
        }
    }

    public final static int TYPE_OPEN_FILE = 0;
    public final static int TYPE_SAVE_FILE = 1;
    private final String DEFAULT_FOLDER_KEY = "DefaultFolder";
    private int m_max_open_file_length;
    private int m_type;
    private String m_folder="";
    private String m_filename;
    private Context m_context;
    private TextView m_folderView;
    private EditText m_filenameEdit;
    private ArrayList<FileInfo> m_fileInfos;
    private Drawable m_folderIcon;
    private HashMap<String, Drawable> m_iconMap;
    private int m_selected;
    private Callback m_callback;

    public interface Callback{
        void doFileOperation(int type, FileInfo fileInfo);
    }

    ChooseFileDialog(Context context, Callback callback, int type, String filename, int max_open_file_length) {
        super(context);
        m_context = context;
        m_callback = callback;
        m_type = type;
        m_filename = filename;
        m_max_open_file_length = max_open_file_length;

        m_fileInfos = new ArrayList<>();

        m_folderIcon = ContextCompat.getDrawable(m_context, R.drawable.folder);

        m_iconMap = new HashMap<>();
        m_iconMap.put("folder", Utilities.getLocalFileIcon(m_context, "folder"));

        String[] fileTypes = m_context.getResources().getStringArray(R.array.local_file_icon_list);

        for (String fileType : fileTypes) {
            m_iconMap.put(fileType, Utilities.getLocalFileIcon(m_context, fileType));
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LayoutInflater inflater = (LayoutInflater) getContext().getSystemService(Context.LAYOUT_INFLATER_SERVICE);
        View view = inflater.inflate(R.layout.choose_file_dialog, null);
        setContentView(view);

        GridView gridView = view.findViewById(R.id.choose_file_dialog_grid_view);
        gridView.setOnItemClickListener(this);
        gridView.setAdapter(this);

        Button cancelButton = findViewById(R.id.choose_file_dialog_cancel_button);
        if (cancelButton != null) { cancelButton.setOnClickListener(this); }

        Button okButton = findViewById(R.id.choose_file_dialog_ok_button);
        if (okButton != null) { okButton.setOnClickListener(this); }

        TextView titleView = findViewById(R.id.choose_file_dialog_title);
        m_folderView = findViewById(R.id.choose_file_dialog_folder);
        m_filenameEdit = findViewById(R.id.choose_file_dialog_filename);

        if (m_type == TYPE_OPEN_FILE) {
            if (titleView != null) { titleView.setText(R.string.choose_file_dialog_open_title); }
            if (m_filenameEdit != null) { m_filenameEdit.setEnabled(false); }
            if (okButton != null) {
                okButton.setText(R.string.choose_file_dialog_open_button); }
        } else if (m_type == TYPE_SAVE_FILE) {
            if (titleView != null) { titleView.setText(R.string.choose_file_dialog_save_title); }
            if (m_filenameEdit != null) { m_filenameEdit.setEnabled(true); if (m_filename != null) { m_filenameEdit.setText(m_filename); } }
            if (okButton != null) {
                okButton.setText(R.string.choose_file_dialog_save_button); }
        }

        setFolder(getDefaultFolder());

        Window window = getWindow();
        if (window != null) {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM);
            getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
        }
    }

    private String getDefaultFolder() {
        SharedPreferences sharedPreferences = m_context.getSharedPreferences(m_context.getPackageName(), Context.MODE_PRIVATE);
        return sharedPreferences.getString(DEFAULT_FOLDER_KEY, Environment.getExternalStorageDirectory().getAbsolutePath());
    }

    private void setDefaultFolder(String folder) {
        SharedPreferences sharedPreferences = m_context.getSharedPreferences(m_context.getPackageName(), Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = sharedPreferences.edit();
        editor.putString(DEFAULT_FOLDER_KEY, folder);
        editor.apply();
    }

    private void setFolder(String folder) {
        m_folder = folder;
        m_folderView.setText(m_folder);
        m_fileInfos.clear();

        if (!m_folder.equals("/")) { m_fileInfos.add(new FileInfo(null, "..", null, m_folderIcon, true)); }

        File dir = new File(m_folder);
        File[] files = dir.listFiles();

        if (files != null && files.length > 0) {

            for (File file : files) {

                String filename = file.getName();

                if (file.isDirectory() && file.canRead()) {

                    m_fileInfos.add(new FileInfo(null, filename, null, m_folderIcon, true));

                } else if (file.isFile()) {

                    String ext = filename.substring(filename.lastIndexOf('.') + 1);
                    Drawable drawable = m_iconMap.get(ext);

                    if (drawable == null) {
                        drawable = m_iconMap.get("default");
                    }

                    m_fileInfos.add(new FileInfo(file.getAbsolutePath(), filename, ext, drawable, false));
                }
            }
        }

        notifyDataSetChanged();
        notifyDataSetInvalidated();
    }
}
