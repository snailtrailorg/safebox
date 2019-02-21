package org.snailtrail.safebox;

import android.app.AlertDialog;
import android.content.Context;
import android.os.AsyncTask;
import android.os.Bundle;
import android.os.Handler;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.TextView;

import java.security.PublicKey;

public abstract class AddItemDialog extends AlertDialog implements View.OnClickListener, View.OnTouchListener {
    public int m_resource;
    public Handler m_uiHandler;
    public View m_view;
    public PublicKey m_publicKey;
    public SqliteOpenHelper.ItemInfo m_itemInfo;

    public AddItemDialog(Context context, int resource, Handler uiHandler, PublicKey publicKey) {
        super(context);
        m_resource = resource;
        m_uiHandler = uiHandler;
        m_publicKey = publicKey;
        m_itemInfo = null;
    }

    public abstract void composeUserData();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        m_itemInfo = new SqliteOpenHelper.ItemInfo();

        LayoutInflater inflater = (LayoutInflater) getContext().getSystemService(Context.LAYOUT_INFLATER_SERVICE);
        m_view = inflater.inflate(m_resource, null);
        setContentView(m_view);

        setCancelable(false);

        m_view.findViewById(R.id.add_item_progress_panel).setVisibility(View.GONE);
        m_view.findViewById(R.id.add_item_form_panel).setVisibility(View.VISIBLE);

        m_view.findViewById(R.id.add_item_cancel_button).setOnClickListener(this);
        m_view.findViewById(R.id.add_item_add_button).setOnClickListener(this);
        m_view.setOnTouchListener(this);

        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
    }

    @Override
    public void dismiss() {
        m_view.setOnTouchListener(null);
        m_view.findViewById(R.id.add_item_add_button).setOnClickListener(null);
        m_view.findViewById(R.id.add_item_cancel_button).setOnClickListener(null);

        super.dismiss();
    }

    @Override
    public void onClick(View view) {
        switch (view.getId()) {
            case R.id.add_item_add_button:
                onClickCreate(view);
                break;
            case R.id.add_item_cancel_button:
                onClickCancel(view);
                break;
            default:
                //do nothing
        }
    }

    @Override
    public boolean onTouch(View v, MotionEvent event) {
        InputMethodManager imm = (InputMethodManager) getContext().getSystemService(Context.INPUT_METHOD_SERVICE);
        imm.hideSoftInputFromWindow(v.getWindowToken(), 0);

        v.performClick();
        return false;
    }

    private void onClickCancel(View view) {
        dismiss();
    }

    private void onClickCreate(View view) {
        InputMethodManager imm = (InputMethodManager) getContext().getSystemService(Context.INPUT_METHOD_SERVICE);
        imm.hideSoftInputFromWindow(view.getWindowToken(), 0);

        composeUserData();

        m_view.findViewById(R.id.add_item_form_panel).setVisibility(View.GONE);
        m_view.findViewById(R.id.add_item_progress_panel).setVisibility(View.VISIBLE);

        new AddItemTask().execute(m_itemInfo);
    }

    private class AddItemTask extends AsyncTask<SqliteOpenHelper.ItemInfo, Integer, Integer> {

        private static final int ADD_ITEM_PROGRESS_START = 0;
        private static final int ADD_ITEM_PROGRESS_ENCRYPT_DATA = 1;
        private static final int ADD_ITEM_PROGRESS_SAVE_ITEM = 2;
        private static final int ADD_ITEM_PROGRESS_UPLOAD_ITEM = 3;
        private static final int ADD_ITEM_PROGRESS_FINISHED = 5;

        private static final int ADD_ITEM_RESULT_SUCCESS = 0;
        private static final int ADD_ITEM_RESULT_ERROR_ENCRYPT_DATA_FAILED = 1;
        private static final int ADD_ITEM_RESULT_ERROR_SAVE_ITEM_FAILED = 2;
        private static final int ADD_ITEM_RESULT_ERRIR_UPLOAD_ITEM_FAILED = 3;

        @Override
        protected void onPreExecute() {
            super.onPreExecute();
        }

        @Override
        protected Integer doInBackground(SqliteOpenHelper.ItemInfo... parameter) {

            SqliteOpenHelper.ItemInfo itemInfo = parameter[0];

            SqliteOpenHelper sqliteOpenHelper;

            publishProgress(ADD_ITEM_PROGRESS_START);
            // do something?

            publishProgress(ADD_ITEM_PROGRESS_ENCRYPT_DATA);

            String encryptedData = Utilities.rsaEncrypt(m_publicKey, itemInfo.m_data);
            if (encryptedData == null) {
                return ADD_ITEM_RESULT_ERROR_ENCRYPT_DATA_FAILED;
            } else {
                itemInfo.m_data = encryptedData;
            }

            publishProgress(ADD_ITEM_PROGRESS_SAVE_ITEM);

            sqliteOpenHelper = new SqliteOpenHelper(getContext());
            long saveResult = sqliteOpenHelper.insertItem(itemInfo);
            sqliteOpenHelper.close();

            if (saveResult == -1) {
                return ADD_ITEM_RESULT_ERROR_SAVE_ITEM_FAILED;
            }


            publishProgress(ADD_ITEM_PROGRESS_FINISHED);

            m_uiHandler.sendEmptyMessage(R.integer.MESSAGE_DO_SIGN_IN);

            return ADD_ITEM_RESULT_SUCCESS;
        }

        @Override
        protected void onProgressUpdate(Integer... progress) {
            TextView progressMessageTextView = m_view.findViewById(R.id.sign_up_progress_message);

            switch (progress[0]) {
                case ADD_ITEM_PROGRESS_START:
                    progressMessageTextView.setText(R.string.add_item_progress_start);
                    break;
                case ADD_ITEM_PROGRESS_ENCRYPT_DATA:
                    progressMessageTextView.setText(R.string.add_item_progress_encrypt_data);
                    break;
                case ADD_ITEM_PROGRESS_SAVE_ITEM:
                    progressMessageTextView.setText(R.string.add_item_progress_save_item);
                    break;
                case ADD_ITEM_PROGRESS_UPLOAD_ITEM:
                    progressMessageTextView.setText(R.string.add_item_progress_upload_item);
                    break;
                case ADD_ITEM_PROGRESS_FINISHED:
                    progressMessageTextView.setText(R.string.add_item_progress_finish);
                    break;
                default:
            }
        }

        @Override
        protected void onPostExecute(Integer result) {
            switch (result) {
                case ADD_ITEM_RESULT_ERROR_ENCRYPT_DATA_FAILED:
                    Utilities.showMessageBox(getContext(), R.string.error_dialog_title, R.string.sign_up_result_error_email_conflicted);
                    break;
                case ADD_ITEM_RESULT_ERROR_SAVE_ITEM_FAILED:
                    Utilities.showMessageBox(getContext(), R.string.error_dialog_title, R.string.sign_up_result_error_calculate_digest_failed);
                    break;
                case ADD_ITEM_RESULT_ERRIR_UPLOAD_ITEM_FAILED:
                    Utilities.showMessageBox(getContext(), R.string.error_dialog_title, R.string.sign_up_result_error_generate_rsa_key_failed);
                    break;
                case ADD_ITEM_RESULT_SUCCESS:
                    Utilities.jam(getContext(), R.string.sign_up_result_success);
                    dismiss();
                    break;
                default:
            }

            m_view.findViewById(R.id.sign_up_progress_panel).setVisibility(View.GONE);
            m_view.findViewById(R.id.sign_up_form_panel).setVisibility(View.VISIBLE);
        }
    }
}
