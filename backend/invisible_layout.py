import sys
import os
from PyQt6.QtWidgets import QApplication, QMainWindow, QLabel, QWidget, QVBoxLayout
from PyQt6.QtCore import Qt, QPoint
from PyQt6.QtGui import QPainter, QColor, QPen, QBrush, QPixmap

class AprilTagOverlay(QMainWindow):
    def __init__(self, image_path, tag_id, tag_size=100):
        super().__init__()

        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint | 
            Qt.WindowType.WindowStaysOnTopHint |
            Qt.WindowType.Tool    # Hide taskbar
        )
        
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)

        self.central_widget = QWidget()
        self.setCentralWidget(self.central_widget)
        self.layout = QVBoxLayout(self.central_widget)
        self.layout.setContentsMargins(0, 0, 0, 0)
        self.layout.setSpacing(0)
        
        # Add Title Label
        self.title_label = QLabel(f"ID: {tag_id}")
        self.title_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.title_label.setStyleSheet("background-color: rgba(0, 0, 0, 150); color: white; font-weight: bold; padding: 2px;")
        self.layout.addWidget(self.title_label)
        
        self.tag_label = QLabel()
        pixmap = QPixmap(image_path)
        
        if not pixmap.isNull():
            pixmap = pixmap.scaled(tag_size, tag_size, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            self.tag_label.setPixmap(pixmap)
            self.tag_label.setFixedSize(pixmap.size())
            self.title_label.setFixedWidth(pixmap.width())
        else:
            self.tag_label.setText(f"Error: {os.path.basename(image_path)}")
            self.tag_label.setStyleSheet("background-color: white; color: red; border: 1px solid red;")
            self.resize(200, 200)

        self.layout.addWidget(self.tag_label)
        self.adjustSize()

        self.old_pos = None

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.old_pos = event.globalPosition().toPoint()

    def mouseMoveEvent(self, event):
        if self.old_pos:
            delta = event.globalPosition().toPoint() - self.old_pos
            self.move(self.pos() + delta)
            self.old_pos = event.globalPosition().toPoint()

    def mouseReleaseEvent(self, event):
        self.old_pos = None
        
    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_Escape:
            QApplication.instance().quit()

if __name__ == '__main__':
    app = QApplication(sys.argv)
    
    ids = [1, 2, 3, 4, 5, 6]
    windows = []
    base_dir = os.path.dirname(os.path.abspath(__file__))
    tags_dir = os.path.join(base_dir, '../generated_tags')
    
    for i, tag_id in enumerate(ids):
        filename = f"tag25h9_id{tag_id:02d}.png"
        file_path = os.path.join(tags_dir, filename)
        
        if os.path.exists(file_path):
            tag_size = 50 if tag_id in [4, 5] else 80
            window = AprilTagOverlay(file_path, tag_id, tag_size)
            
            screen_geom = app.primaryScreen().geometry()
            s_width = screen_geom.width()
            s_height = screen_geom.height()
            w = window.width()
            h = window.height()
            
            x, y = 100 + (i * 150), 100  # Default position
            
            if tag_id == 1:   # Top Left
                x, y = 0, 25
            elif tag_id == 2: # Top Right
                x, y = s_width - w + 125, 25
            elif tag_id == 3: # Bottom Right
                x, y = s_width - w + 125, s_height - h - 10
            elif tag_id == 4: # Bottom Left
                x, y = 0, s_height - h - 10
            
            window.move(x, y)
            window.show()
            windows.append(window)
        else:
            print(f"Warning: Tag file not found: {file_path}")
            
    if not windows:
        print("No tags loaded.")
        sys.exit(1)

    sys.exit(app.exec())