import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { SignalViewerComponent } from './components/signal-viewer/signal-viewer.component';
import { GenericModePanelComponent } from './components/generic-mode-panel/generic-mode-panel.component';
import { EqSidebarComponent } from './components/eq-sidebar/eq-sidebar.component';

@NgModule({
  declarations: [
    AppComponent,
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    FormsModule,
    SignalViewerComponent, 
    GenericModePanelComponent,
    EqSidebarComponent
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
