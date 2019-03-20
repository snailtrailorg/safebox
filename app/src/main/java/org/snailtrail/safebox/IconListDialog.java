package org.snailtrail.safebox;

import android.app.AlertDialog;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Rect;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Message;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.GridView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

public abstract  class IconListDialog extends AlertDialog {
    public Context m_context;
    public int m_resource;
    public ArrayList<IconInfo> m_iconInfos;
    public View m_view;
    public Handler m_handler;

    static class IconInfo {
        Drawable m_drawable;
        String m_name;
        String m_identifier;

        public IconInfo(Drawable drawable, String name, String identifier) {
            m_drawable = drawable;
            m_name = name;
            m_identifier = identifier;
        }
    }

    protected IconListDialog(Context context, int resource, Handler handler) {
        super(context);
        m_context = context;
        m_resource = resource;
        m_handler = handler;
        m_iconInfos = loadIconInfos();
    }

    protected abstract ArrayList<IconInfo> loadIconInfos();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LayoutInflater inflater = (LayoutInflater) getContext().getSystemService(Context.LAYOUT_INFLATER_SERVICE);
        m_view = inflater.inflate(m_resource, null);
        setContentView(m_view);

        setCancelable(false);

        GridView gridView = m_view.findViewById(R.id.icon_list_dialog_grid_view);

        gridView.setAdapter(new BaseAdapter() {
            @Override
            public int getCount() {
                return (m_iconInfos == null) ? 0 : m_iconInfos.size();
            }

            @Override
            public Object getItem(int position) {
                return (m_iconInfos == null) ? 0 : m_iconInfos.get(position);
            }

            @Override
            public long getItemId(int position) {
                return position;
            }

            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                IconInfo iconInfo = m_iconInfos.get(position);

                if (convertView == null) {

                    convertView = LayoutInflater.from(getContext()).inflate(R.layout.icon_list_item, parent, false);

                    TextView textView = convertView.findViewById(R.id.icon_list_item_name);
                    if (textView != null) {
                        Rect rect = textView.getCompoundDrawables()[1].getBounds();
                        textView.setText(iconInfo.m_name);
                        iconInfo.m_drawable.setBounds(rect);
                        textView.setCompoundDrawables(null, iconInfo.m_drawable, null, null);
                        textView.setSingleLine(true);
                    }
                }

                return convertView;
            }
        });

        gridView.setOnItemClickListener(new GridView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                IconInfo iconInfo = m_iconInfos.get(position);

                Message message = new Message();
                message.what = R.id.save_item_icon;
                message.obj = iconInfo;
                m_handler.sendMessage(message);

                dismiss();
            }
        });

        Button button = m_view.findViewById(R.id.icon_list_dialog_button_cancel);

        button.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                dismiss();
            }
        });
    }
}
