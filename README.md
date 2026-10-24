# Tenor Viol Clef Trainer

A web page for learning to read the C clef (alto clef) on the tenor viol da gamba.

Open it here: https://deepspace000.github.io/tenor-viol-trainer/

- One screen: the viol necks at the top, the score underneath scrolling in its own box, and fold-down menus (Practise, Notes, Parts, File, Settings, About). Drag the bar between the necks and the score to give either more room (double-click it to go back). Score size (in Notes) makes the music bigger or smaller.
- The viol neck with every note named. Tap a note to hear it and see it on the staff.
- Treble, tenor and bass viol necks: show any of them (Settings). They sit side by side when there is room. A note tapped on the bass or treble neck is shown on the staff in that viol's clef.
- Quizzes: find a staff note on the neck, name a note on the neck, name a note on the staff.
- Practise: open strings, major and minor scales (natural, harmonic, melodic), chromatic scale, arpeggios, scales in thirds, frets 0 to 4 on each string, and string crossing, from any starting note, in one or two octaves, written into the score to play along with.
- Any key signature, and alto, tenor, octave treble, treble or bass clef.
- A score you write by tapping the neck: breve, semibreve, minim, crotchet, quaver and semiquaver, with dots, rests, ties across bar lines, any time signature (4/1, 6/2, 4/2, 3/4 ...) and tempo. Play it back, save it as .json and load it again, or save it as a PDF.
- Note names and movable-do sol-fa under every note. The note that is playing lights up in the score and on the neck.
- Record from a microphone: the notes you play on the viol are written into the score.
- Import MIDI, MusicXML, or printed music as a PDF or picture. Printed music is read on the page itself: notes, rests, rhythms, dots, ties, bar lines, clefs, key and time signatures (also C and cut C), accidentals, repeat signs and first and second endings. The key signature of each piece is worked out from every staff of the piece and checked against the accidentals in the music.
- Full scores: every staff of a system becomes a part (treble, tenor and bass viols, two trebles and a bass, or any other line-up), each in its own clef. Every part has mute, solo, volume, pan and a violin, viola or cello sound, with reverb over all of them. The parts are kept together bar by bar, and play with their repeats and endings. Play from the start, from any piece, repeated section or ending, from any bar, or from a selected note.
- All parts: every part's staff together, bar by bar, with the parts' names; or one part at a time. Click a note or a name to choose the part you work on.
- When a score plays, each part lights up on the neck of its viol (Viol, per part, under Parts; two parts on one neck show in gold and blue).

Keys: left and right arrows move from note to note in the score, up and down change the rhythm, 1 to 6 pick a rhythm, `.` adds a dot, R adds a rest, Backspace deletes.

Tenor viol tuning: G2 C3 F3 A3 D4 G4 (a fourth above the bass viol).

Uses [VexFlow](https://github.com/0xfe/vexflow) (MIT) for the staves and [PDF.js](https://github.com/mozilla/pdf.js) (Apache 2.0) to open PDFs.
