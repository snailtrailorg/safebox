package org.snailtrail.safebox;

import android.app.AlertDialog;
import android.content.Context;
import android.graphics.drawable.Drawable;
import android.os.AsyncTask;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.TextView;

import org.jetbrains.annotations.NotNull;

import java.lang.ref.WeakReference;
import java.security.PrivateKey;
import java.security.PublicKey;

public abstract class SaveItemDialog extends AlertDialog implements View.OnClickListener, View.OnTouchListener {
    public int m_resource;
    public Handler m_uiHandler;
    public View m_view;
    public PublicKey m_publicKey;
    public PrivateKey m_privateKey;
    public SqliteOpenHelper.ItemInfo m_itemInfo;

    public SaveItemDialog(Context context, int resource, Handler uiHandler, PublicKey publicKey, PrivateKey privateKey, SqliteOpenHelper.ItemInfo itemInfo) {
        super(context);
        m_resource = resource;
        m_uiHandler = uiHandler;
        m_publicKey = publicKey;
        m_privateKey = privateKey;
        m_itemInfo = itemInfo;
    }

    private Handler m_handler = new Handler(Looper.getMainLooper()) {
        @Override
        public void handleMessage(Message msg) {
            if (msg.what == R.id.save_item_icon) {
                setItemIconInfo((IconListDialog.IconInfo) msg.obj);
            } else {
                super.handleMessage(msg);
            }
        }
    };

    public abstract void selectItemIcon(Handler handler);
    public abstract void setItemIconInfo(IconListDialog.IconInfo iconInfo);
    public abstract Drawable getIconInfoByIdentifier(Context context, String identifier);
    public abstract void composeItemData();
    public abstract void extractItemData();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LayoutInflater inflater = (LayoutInflater) getContext().getSystemService(Context.LAYOUT_INFLATER_SERVICE);
        m_view = inflater.inflate(m_resource, null);
        setContentView(m_view);

        setCancelable(false);

        m_view.findViewById(R.id.save_item_progress_panel).setVisibility(View.GONE);
        m_view.findViewById(R.id.save_item_form_panel).setVisibility(View.VISIBLE);

        m_view.findViewById(R.id.save_item_icon).setOnClickListener(this);
        m_view.findViewById(R.id.save_item_cancel_button).setOnClickListener(this);
        m_view.findViewById(R.id.save_item_save_button).setOnClickListener(this);
        m_view.findViewById(R.id.save_item_form_panel).setOnClickListener(this);

        ImageView icon = m_view.findViewById(R.id.save_item_icon);
        Drawable drawable = getIconInfoByIdentifier(getContext(), m_itemInfo.m_icon);
        if (drawable != null) { icon.setImageDrawable(drawable);}

        EditText name = m_view.findViewById(R.id.save_item_name);
        EditText description = m_view.findViewById(R.id.save_item_description);

        name.setText(m_itemInfo.m_name);
        description.setText(m_itemInfo.m_description);

        if (m_itemInfo.m_data != null && m_itemInfo.m_data.length() > 0) {
            m_itemInfo.m_data = Utilities.rsaDecrypt(m_privateKey, m_itemInfo.m_data);
            extractItemData();
        } else {
            m_itemInfo.m_data = "";
        }

        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
    }

    @Override
    public void dismiss() {
        m_view.findViewById(R.id.save_item_form_panel).setOnClickListener(null);
        m_view.findViewById(R.id.save_item_save_button).setOnClickListener(null);
        m_view.findViewById(R.id.save_item_cancel_button).setOnClickListener(null);
        m_view.findViewById(R.id.save_item_icon).setOnClickListener(null);

        super.dismiss();
    }

    @Override
    public void onClick(View view) {
        switch (view.getId()) {
            case R.id.save_item_icon:
                selectItemIcon(m_handler);
                break;
            case R.id.save_item_cancel_button:
                onClickCancel(view);
                break;
            case R.id.save_item_save_button:
                onClickSave(view);
                break;
            default:
                InputMethodManager imm = (InputMethodManager) getContext().getSystemService(Context.INPUT_METHOD_SERVICE);
                imm.hideSoftInputFromWindow(view.getWindowToken(), 0);
        }
    }

    @Override
    public boolean onTouch(View v, MotionEvent event) {
        /*
        InputMethodManager imm = (InputMethodManager) getContext().getSystemService(Context.INPUT_METHOD_SERVICE);
        imm.hideSoftInputFromWindow(v.getWindowToken(), 0);

        v.performClick();
        */
        return false;
    }

    private void onClickCancel(View view) {
        dismiss();
    }

    private void onClickSave(View view) {
        InputMethodManager imm = (InputMethodManager) getContext().getSystemService(Context.INPUT_METHOD_SERVICE);
        imm.hideSoftInputFromWindow(view.getWindowToken(), 0);

        EditText name = m_view.findViewById(R.id.save_item_name);
        EditText description = m_view.findViewById(R.id.save_item_description);

        m_itemInfo.m_name = (name == null) ? "" : name.getText().toString();
        m_itemInfo.m_description = (description == null) ? "" : description.getText().toString();

        composeItemData();

        if (m_itemInfo.m_data == null) { m_itemInfo.m_data = ""; }

        m_view.findViewById(R.id.save_item_form_panel).setVisibility(View.GONE);
        m_view.findViewById(R.id.save_item_progress_panel).setVisibility(View.VISIBLE);

        new SaveItemTask().execute(m_itemInfo);
    }

    private class SaveItemTask extends AsyncTask<SqliteOpenHelper.ItemInfo, Integer, Integer> {

        private static final int SAVE_ITEM_PROGRESS_START = 0;
        private static final int SAVE_ITEM_PROGRESS_ENCRYPT_DATA = 1;
        private static final int SAVE_ITEM_PROGRESS_SAVE_ITEM = 2;
        private static final int SAVE_ITEM_PROGRESS_UPLOAD_ITEM = 3;
        private static final int SAVE_ITEM_PROGRESS_FINISHED = 5;

        private static final int SAVE_ITEM_RESULT_SUCCESS = 0;
        private static final int SAVE_ITEM_RESULT_ERROR_ENCRYPT_DATA_FAILED = 1;
        private static final int SAVE_ITEM_RESULT_ERROR_SAVE_ITEM_FAILED = 2;
        private static final int SAVE_ITEM_RESULT_ERROR_UPLOAD_ITEM_FAILED = 3;

        @Override
        protected void onPreExecute() {
            super.onPreExecute();
        }

        @Override
        protected Integer doInBackground(SqliteOpenHelper.ItemInfo... parameter) {

            SqliteOpenHelper.ItemInfo itemInfo = parameter[0];

            SqliteOpenHelper sqliteOpenHelper;

            publishProgress(SAVE_ITEM_PROGRESS_START);
            // do something?

            publishProgress(SAVE_ITEM_PROGRESS_ENCRYPT_DATA);

            if (itemInfo.m_data != null && itemInfo.m_data.length() > 0) {
                String encryptedData = Utilities.rsaEncrypt(m_publicKey, itemInfo.m_data);
                if (encryptedData == null) {
                    return SAVE_ITEM_RESULT_ERROR_ENCRYPT_DATA_FAILED;
                } else {
                    itemInfo.m_data = encryptedData;
                }
            } else {
                itemInfo.m_data = "";
            }

            publishProgress(SAVE_ITEM_PROGRESS_SAVE_ITEM);

            sqliteOpenHelper = new SqliteOpenHelper(getContext());
            long saveResult = sqliteOpenHelper.saveItem(itemInfo);
            sqliteOpenHelper.close();

            if (saveResult == -1) {
                return SAVE_ITEM_RESULT_ERROR_SAVE_ITEM_FAILED;
            }

            publishProgress(SAVE_ITEM_PROGRESS_FINISHED);

            return SAVE_ITEM_RESULT_SUCCESS;
        }

        @Override
        protected void onProgressUpdate(Integer... progress) {
            TextView progressMessageTextView = m_view.findViewById(R.id.save_item_progress_message);

            switch (progress[0]) {
                case SAVE_ITEM_PROGRESS_START:
                    progressMessageTextView.setText(R.string.save_item_progress_start);
                    break;
                case SAVE_ITEM_PROGRESS_ENCRYPT_DATA:
                    progressMessageTextView.setText(R.string.save_item_progress_encrypt_data);
                    break;
                case SAVE_ITEM_PROGRESS_SAVE_ITEM:
                    progressMessageTextView.setText(R.string.save_item_progress_save_item);
                    break;
                case SAVE_ITEM_PROGRESS_UPLOAD_ITEM:
                    progressMessageTextView.setText(R.string.save_item_progress_upload_item);
                    break;
                case SAVE_ITEM_PROGRESS_FINISHED:
                    progressMessageTextView.setText(R.string.save_item_progress_finish);
                    break;
                default:
            }
        }

        @Override
        protected void onPostExecute(Integer result) {
            switch (result) {
                case SAVE_ITEM_RESULT_ERROR_ENCRYPT_DATA_FAILED:
                    Utilities.showMessageBox(getContext(), R.string.error_dialog_title, R.string.save_item_result_error_encrypt_data_failed);
                    break;
                case SAVE_ITEM_RESULT_ERROR_SAVE_ITEM_FAILED:
                    Utilities.showMessageBox(getContext(), R.string.error_dialog_title, R.string.save_item_result_error_save_item_failed);
                    break;
                case SAVE_ITEM_RESULT_ERROR_UPLOAD_ITEM_FAILED:
                    Utilities.showMessageBox(getContext(), R.string.error_dialog_title, R.string.save_item_result_error_upload_item_failed);
                    break;
                case SAVE_ITEM_RESULT_SUCCESS:
                    m_uiHandler.sendEmptyMessage(R.integer.MESSAGE_LOAD_USER_ITEMS);
                    Utilities.jam(getContext(), R.string.save_item_result_success);
                    dismiss();
                    break;
                default:
            }

            if (result != SAVE_ITEM_RESULT_SUCCESS) {
                m_view.findViewById(R.id.save_item_progress_panel).setVisibility(View.GONE);
                m_view.findViewById(R.id.save_item_form_panel).setVisibility(View.VISIBLE);
            }
        }
    }
}
