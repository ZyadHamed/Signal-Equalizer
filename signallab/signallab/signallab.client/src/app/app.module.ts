import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

import { AppComponent } from './app.component';
import { SignalViewerComponent } from './signal-viewer/signal-viewer.component';

@NgModule({
  declarations: [
    AppComponent,
  ],
  imports: [
    BrowserModule,
    FormsModule,
    CommonModule,
    SignalViewerComponent,
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
