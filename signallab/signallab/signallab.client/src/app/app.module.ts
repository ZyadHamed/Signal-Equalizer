import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { SignalViewerComponent } from './signal-viewer/signal-viewer.component';

@NgModule({
  declarations: [
    AppComponent,
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    FormsModule,
    SignalViewerComponent, // standalone → imports لا declarations
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
